import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { WIKI_BASE_DIR, WIKI_DOC_PARAM_KEY } from "../../constants/commonKey.js";
import { isWikiCategoryId, type WikiCategoryId } from "../../constants/wikiCategory.js";
import type { GitRepoInitPair } from "../../db/gitRepoPair.js";
import { getParentTaskParamByParentAndKey } from "../../db/workflow.js";
import { getWikiDocSourceConfigByCategory, getCodeRepoRowBySlot } from "../../db/wikiSource.js";
import {
  isWikiQaCodeRepoSlot,
  normalizeWikiStorySplitDocTypes,
  WIKI_SOURCE_TYPE,
  type WikiQaCodeRepoSlot,
  type WikiStorySplitDocSourceType,
} from "../../constants/wikiSourceType.js";
import { parseCodeRepoWikiUrl } from "../wiki/codeRepoWikiSource.js";
import { copyCodeRepoSlotsToDir } from "./copyCodeBaseToDir.js";
import { assertSafeWikiCategoryId, listWikiBaseFiles } from "./wikiBaseFiles.js";
import {
  normalizeWikiQaUsername,
  wikiQaWorkspaceDir,
  writeWikiQaCopiedSinceMarker,
} from "./wikiQaAiOutput.js";

function resolveCodeRepoPairBySlot(
  config: ReturnType<typeof getWikiDocSourceConfigByCategory>,
  slot: WikiQaCodeRepoSlot,
): GitRepoInitPair | null {
  const row = getCodeRepoRowBySlot(config, slot);
  if (!row) return null;
  return parseCodeRepoWikiUrl(row.wiki_url);
}

export type PrepareWikiQaDemoWorkspaceOptions = {
  /** 登录用户名，对应 `task-repo/<username>/` */
  username: string;
  /** 复制 `wiki_base/<categoryId>/` 下 Confluence 同步文档 */
  includeConfluenceDocs?: boolean;
  /** 复制 `wiki_base/<categoryId>/自动化测试案例/` 下已同步 JSON */
  includeAutomatedTestCases?: boolean;
  /** 要从 `code_base` 复制的代码库槽位（1..10） */
  codeRepoSlots?: WikiQaCodeRepoSlot[];
  db?: DatabaseSync;
};

export type PrepareWikiQaDemoWorkspaceResult = {
  /** 复制的 Confluence 文档数 */
  copied: number;
  /** 复制的自动化测试案例文件数 */
  test_case_copied: number;
  /** 复制的代码文件数 */
  code_copied: number;
  code_slots: WikiQaCodeRepoSlot[];
  demo_cwd: string;
  /** 复制完成时刻（毫秒）；用于筛选此后 AI 新增/修改的文件 */
  copied_since_ms: number;
};

/** `parent_task_params.wiki_doc` 的 JSON 结构 */
export type WikiDocParamJson = {
  category_id?: string;
  category_label?: string;
  relative_path?: string;
  wiki_path?: string;
  /** 认领任务时复制到工作区的 Confluence 文档类型目录 */
  include_doc_types: WikiStorySplitDocSourceType[];
  /** 认领任务时克隆的代码库槽位（1..10） */
  include_code_repo_slots: WikiQaCodeRepoSlot[];
};

export function parseWikiDocParamJson(valueJson: string | null | undefined): WikiDocParamJson | null {
  if (!valueJson?.trim()) return null;
  try {
    const raw = JSON.parse(valueJson) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    return {
      category_id: typeof o.category_id === "string" ? o.category_id.trim() : undefined,
      category_label: typeof o.category_label === "string" ? o.category_label.trim() : undefined,
      relative_path: typeof o.relative_path === "string" ? o.relative_path.trim() : undefined,
      wiki_path: typeof o.wiki_path === "string" ? o.wiki_path.trim() : undefined,
      include_doc_types: normalizeWikiStorySplitDocTypes(o.include_doc_types),
      include_code_repo_slots: Array.isArray(o.include_code_repo_slots)
        ? [...new Set(o.include_code_repo_slots.filter(isWikiQaCodeRepoSlot))].sort((a, b) => a - b)
        : [],
    };
  } catch {
    return null;
  }
}

/** 解析 `parent_task_params.wiki_doc` 的 `category_id` */
export function resolveWikiCategoryIdFromParent(
  db: DatabaseSync,
  parentTaskId: string,
): string | null {
  const row = getParentTaskParamByParentAndKey(db, parentTaskId, WIKI_DOC_PARAM_KEY);
  const param = parseWikiDocParamJson(row?.value_json);
  const categoryId = param?.category_id ?? "";
  return isWikiCategoryId(categoryId) ? categoryId : null;
}

/** 按 `wiki_doc.include_code_repo_slots` 从文档源配置解析 Git 仓库 */
export function resolveGitReposFromWikiDocSlots(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
  slots: readonly WikiQaCodeRepoSlot[],
): GitRepoInitPair[] {
  const config = getWikiDocSourceConfigByCategory(db, categoryId);
  const repos: GitRepoInitPair[] = [];
  for (const slot of slots) {
    const pair = resolveCodeRepoPairBySlot(config, slot);
    if (pair?.gitRemoteUrl) repos.push(pair);
  }
  return repos;
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

/** 仅复制指定顶层目录下的 Wiki 文档（如 `基线文档/`、`自动化测试案例/`） */
export function copyWikiCategorySourceTypesToDir(
  categoryId: string,
  targetDir: string,
  sourceTypes: readonly string[],
): number {
  assertSafeWikiCategoryId(categoryId);
  if (sourceTypes.length === 0) return 0;

  const typeSet = new Set<string>(sourceTypes);
  const destRoot = resolve(targetDir);
  mkdirSync(destRoot, { recursive: true });

  const files = listWikiBaseFiles(categoryId);
  const categoryRoot = join(resolve(process.cwd(), WIKI_BASE_DIR), categoryId);
  let copied = 0;

  for (const file of files) {
    const topDir = file.relative_path.split("/")[0] ?? "";
    if (!typeSet.has(topDir)) continue;
    const src = join(categoryRoot, file.relative_path);
    const dest = join(destRoot, file.relative_path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    copied++;
  }

  return copied;
}

/**
 * 智能问答前：清空 `task-repo/<username>/`，同步复制 Confluence 文档与 `code_base` 代码文件。
 */
export function prepareWikiQaDemoWorkspace(
  categoryId: string,
  options: PrepareWikiQaDemoWorkspaceOptions,
): PrepareWikiQaDemoWorkspaceResult {
  assertSafeWikiCategoryId(categoryId);
  const username = normalizeWikiQaUsername(options.username);
  const includeConfluenceDocs = options.includeConfluenceDocs ?? false;
  const includeAutomatedTestCases = options.includeAutomatedTestCases ?? false;
  const codeRepoSlots = [...new Set(options.codeRepoSlots ?? [])]
    .filter(isWikiQaCodeRepoSlot)
    .sort((a, b) => a - b);

  if (!includeConfluenceDocs && !includeAutomatedTestCases && codeRepoSlots.length === 0) {
    throw new Error("请至少选择添加 Confluence 文档、自动化测试案例或添加代码库");
  }

  const workspaceCwd = wikiQaWorkspaceDir(username);
  if (existsSync(workspaceCwd)) {
    rmSync(workspaceCwd, { recursive: true, force: true });
  }
  mkdirSync(workspaceCwd, { recursive: true });

  const copied = includeConfluenceDocs ? copyWikiCategoryToDir(categoryId, workspaceCwd) : 0;

  const test_case_copied = includeAutomatedTestCases
    ? copyWikiCategorySourceTypesToDir(categoryId, workspaceCwd, [WIKI_SOURCE_TYPE.AutomatedTestCase])
    : 0;

  let code_copied = 0;
  if (codeRepoSlots.length > 0) {
    if (!options.db) {
      throw new Error("copy code repo requires db");
    }
    code_copied = copyCodeRepoSlotsToDir(options.db, categoryId, workspaceCwd, codeRepoSlots);
  }

  const copied_since_ms = Date.now();
  writeWikiQaCopiedSinceMarker(workspaceCwd, copied_since_ms);

  return {
    copied,
    test_case_copied,
    code_copied,
    code_slots: codeRepoSlots,
    demo_cwd: workspaceCwd,
    copied_since_ms,
  };
}
