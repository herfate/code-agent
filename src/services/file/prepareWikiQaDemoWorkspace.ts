import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { WIKI_BASE_DIR, WIKI_DOC_PARAM_KEY } from "../../constants/commonKey.js";
import { isWikiCategoryId, type WikiCategoryId } from "../../constants/wikiCategory.js";
import type { GitRepoInitPair } from "../../db/gitRepoPair.js";
import { getParentTaskParamByParentAndKey } from "../../db/workflow.js";
import { getWikiDocSourceConfigByCategory, getCodeRepoRowBySlot } from "../../db/wikiSource.js";
import {
  isWikiQaCodeRepoSlot,
  wikiCodeRepoConfigLabel,
  type WikiQaCodeRepoSlot,
} from "../../constants/wikiSourceType.js";
import { parseCodeRepoWikiUrl } from "../wiki/codeRepoWikiSource.js";
import { cloneRepo, type CloneRepoInput } from "../tools/gitlabTool.js";
import {
  type GitRepoWorkspacePlan,
  repoDirNameFromGitRemoteUrl,
  resolveGitRepoWorkspacePath,
} from "../tools/gitRepoWorkspace.js";
import { assertSafeWikiCategoryId, listWikiBaseFiles } from "./wikiBaseFiles.js";

const DEMO_PID = "demo";

/** 智能问答克隆 token（先用第一个，失败再试第二个；TODO 后期改用户配置） */
const WIKI_QA_CLONE_TOKENS = [""] as const;

function removePathIfExists(targetPath: string): void {
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }
}

/** 依次用固定 token 克隆，前一个失败则清理目录后换下一个 */
async function cloneRepoWithTokenFallback(
  input: Omit<CloneRepoInput, "token">,
  tokens: readonly string[],
): Promise<void> {
  if (tokens.length === 0) {
    throw new Error("cloneRepo: 未配置克隆 token");
  }
  let lastError: unknown;
  for (let i = 0; i < tokens.length; i++) {
    removePathIfExists(input.targetPath);
    try {
      await cloneRepo({ ...input, token: tokens[i] });
      return;
    } catch (e) {
      lastError = e;
      if (i < tokens.length - 1) {
        removePathIfExists(input.targetPath);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 智能问答克隆始终使用命名子目录，避免与根目录 Confluence 文档冲突 */
function planWikiQaCloneDirs(repos: GitRepoInitPair[]): GitRepoWorkspacePlan[] {
  const used = new Set<string>();
  return repos.map((r) => {
    const base = repoDirNameFromGitRemoteUrl(r.gitRemoteUrl);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}-${n++}`;
    }
    used.add(name);
    return { ...r, relDir: name };
  });
}

function resolveCodeRepoPairBySlot(
  config: ReturnType<typeof getWikiDocSourceConfigByCategory>,
  slot: WikiQaCodeRepoSlot,
): GitRepoInitPair | null {
  const row = getCodeRepoRowBySlot(config, slot);
  if (!row) return null;
  return parseCodeRepoWikiUrl(row.wiki_url);
}

export type PrepareWikiQaDemoWorkspaceOptions = {
  /** 复制 `wiki_base/<categoryId>/` 下 Confluence 同步文档 */
  includeConfluenceDocs?: boolean;
  /** 要后台克隆的代码库槽位（1..5） */
  codeRepoSlots?: WikiQaCodeRepoSlot[];
  db?: DatabaseSync;
  /** HTTPS 克隆用户名（Basic Auth 用户名部分） */
  creator?: string | null;
  log?: FastifyBaseLogger;
};

export type PrepareWikiQaDemoWorkspaceResult = {
  copied: number;
  /** 是否已触发后台克隆（不等待完成） */
  clone_started: boolean;
  clone_slots: WikiQaCodeRepoSlot[];
  demo_cwd: string;
};

/** 解析 `parent_task_params.wiki_doc` 的 `category_id` */
export function resolveWikiCategoryIdFromParent(
  db: DatabaseSync,
  parentTaskId: string,
): string | null {
  const row = getParentTaskParamByParentAndKey(db, parentTaskId, WIKI_DOC_PARAM_KEY);
  if (!row?.value_json?.trim()) return null;
  try {
    const raw = JSON.parse(row.value_json) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const categoryId = String((raw as Record<string, unknown>).category_id ?? "").trim();
    return isWikiCategoryId(categoryId) ? categoryId : null;
  } catch {
    return null;
  }
}

/** 将 `wiki_base/<categoryId>/` 下可预览文档复制到目标目录（保留相对路径，不清空目标目录） */
export function copyWikiCategoryToDir(categoryId: string, targetDir: string): number {
  assertSafeWikiCategoryId(categoryId);
  const destRoot = resolve(targetDir);
  mkdirSync(destRoot, { recursive: true });

  const files = listWikiBaseFiles(categoryId);
  const categoryRoot = join(resolve(process.cwd(), WIKI_BASE_DIR), categoryId);

  for (const file of files) {
    const src = join(categoryRoot, file.relative_path);
    const dest = join(destRoot, file.relative_path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }

  return files.length;
}

async function cloneWikiQaRepos(
  demoCwd: string,
  plans: GitRepoWorkspacePlan[],
  creator: string | null | undefined,
): Promise<void> {
  for (const plan of plans) {
    const targetPath = resolveGitRepoWorkspacePath(demoCwd, plan.relDir);
    await cloneRepoWithTokenFallback(
      {
        remoteUrl: plan.gitRemoteUrl,
        targetPath,
        branch: plan.branch_version,
        httpsTokenUsername: creator?.trim() || undefined,
      },
      WIKI_QA_CLONE_TOKENS,
    );
  }
}

function startWikiQaRepoClonesAsync(
  demoCwd: string,
  plans: GitRepoWorkspacePlan[],
  creator: string | null | undefined,
  log?: FastifyBaseLogger,
): void {
  void cloneWikiQaRepos(demoCwd, plans, creator).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error({ err, demoCwd, repoCount: plans.length }, "wiki qa background clone failed");
    if (!log) {
      console.error("wiki qa background clone failed:", msg);
    }
  });
}

/**
 * 智能问答前：清空 `task-repo/demo`，同步复制 Confluence 文档；代码库在后台异步克隆。
 */
export function prepareWikiQaDemoWorkspace(
  categoryId: string,
  options: PrepareWikiQaDemoWorkspaceOptions = {},
): PrepareWikiQaDemoWorkspaceResult {
  assertSafeWikiCategoryId(categoryId);
  const includeConfluenceDocs = options.includeConfluenceDocs ?? false;
  const codeRepoSlots = [...new Set(options.codeRepoSlots ?? [])]
    .filter(isWikiQaCodeRepoSlot)
    .sort((a, b) => a - b);

  if (!includeConfluenceDocs && codeRepoSlots.length === 0) {
    throw new Error("请至少选择添加 Confluence 文档或添加代码库");
  }

  const demoCwd = resolve(process.cwd(), "task-repo", DEMO_PID);
  if (existsSync(demoCwd)) {
    rmSync(demoCwd, { recursive: true, force: true });
  }
  mkdirSync(demoCwd, { recursive: true });

  const copied = includeConfluenceDocs ? copyWikiCategoryToDir(categoryId, demoCwd) : 0;

  let clone_started = false;
  if (codeRepoSlots.length > 0) {
    if (!options.db) {
      throw new Error("clone code repo requires db");
    }
    const config = getWikiDocSourceConfigByCategory(options.db, categoryId as WikiCategoryId);
    const repos: GitRepoInitPair[] = [];
    for (const slot of codeRepoSlots) {
      const pair = resolveCodeRepoPairBySlot(config, slot);
      if (!pair?.gitRemoteUrl) {
        throw new Error(
          `代码库 ${slot} 未配置，请先在「文档源配置」中填写${wikiCodeRepoConfigLabel(slot)}`,
        );
      }
      repos.push(pair);
    }
    const plans = planWikiQaCloneDirs(repos);
    startWikiQaRepoClonesAsync(demoCwd, plans, options.creator, options.log);
    clone_started = true;
  }

  return { copied, clone_started, clone_slots: codeRepoSlots, demo_cwd: demoCwd };
}
