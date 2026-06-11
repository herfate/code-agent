import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CODE_BASE_DIR } from "../../constants/commonKey.js";
import type { WikiCategoryId } from "../../constants/wikiCategory.js";
import {
  isWikiQaCodeRepoSlot,
  WIKI_CODE_REPO_SOURCE_TYPES,
  wikiCodeRepoConfigLabel,
  wikiCodeRepoSourceTypeForSlot,
  wikiSourceTypeLabel,
  type WikiQaCodeRepoSlot,
  type WikiSourceType,
} from "../../constants/wikiSourceType.js";
import {
  getCodeRepoRowBySlot,
  getWikiDocSourceConfigByCategory,
  touchWikiSourceSyncedAt,
  type WikiSourceRow,
} from "../../db/wikiSource.js";
import { parseCodeRepoWikiUrl } from "./codeRepoWikiSource.js";
import { syncOrCloneRepoWithTokenFallback } from "../tools/gitlabTool.js";

/** 智能问答 / 代码库同步 token（先用第一个，失败再试第二个；TODO 后期改用户配置） */
const WIKI_QA_CLONE_TOKENS = ["EEgAsFgn458UtsEsop8F", "WoZzxkgsqXwMAkHwiCDX", "fCzJGK1TB4DLS6Z6RA4M"] as const;

export type CodeRepoSyncItemResult = {
  id: string;
  source_type: string;
  source_type_label: string;
  wiki_url: string;
  /** 相对项目根，如 `code_base/1/代码地址` */
  output_dir: string;
  action?: "cloned" | "updated";
  synced_at: number | null;
  skipped?: boolean;
  skip_reason?: string;
  error?: string;
};

export type WikiCategoryCodeRepoSyncResult = {
  category_id: WikiCategoryId;
  sources: CodeRepoSyncItemResult[];
};

/** `code_base/<categoryId>/<sourceType>/` 绝对路径 */
export function codeBaseCategorySourceDir(
  categoryId: WikiCategoryId,
  sourceType: WikiSourceType,
): string {
  return join(resolve(process.cwd(), CODE_BASE_DIR), categoryId, sourceType);
}

function writeCodeSyncErrorFile(dir: string, message: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "_sync_errors.txt"), message + "\n", "utf8");
}

async function syncOneCodeRepoRow(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
  row: WikiSourceRow,
  tokens: readonly string[],
  branchOverride?: string,
): Promise<CodeRepoSyncItemResult> {
  const wikiUrl = row.wiki_url.trim();
  const outputRel = `${CODE_BASE_DIR}/${categoryId}/${row.source_type}`;
  const base: CodeRepoSyncItemResult = {
    id: row.id,
    source_type: row.source_type,
    source_type_label: wikiSourceTypeLabel(row.source_type),
    wiki_url: wikiUrl,
    output_dir: outputRel,
    synced_at: row.synced_at,
  };

  if (!wikiUrl) {
    return { ...base, skipped: true, skip_reason: "未配置代码库地址" };
  }

  const pair = parseCodeRepoWikiUrl(wikiUrl);
  if (!pair?.gitRemoteUrl) {
    return { ...base, skipped: true, skip_reason: "代码库地址格式无效" };
  }

  if (tokens.length === 0) {
    return { ...base, skipped: true, skip_reason: "未配置 gitlab_token（全局 system_config）" };
  }

  const branch = branchOverride?.trim() || pair.branch_version;
  const targetDir = codeBaseCategorySourceDir(categoryId, row.source_type);
  try {
    const action = await syncOrCloneRepoWithTokenFallback(
      {
        remoteUrl: pair.gitRemoteUrl,
        targetPath: targetDir,
        branch,
        depth: 1,
      },
      tokens,
    );
    const updated = touchWikiSourceSyncedAt(db, row.id);
    return {
      ...base,
      action,
      synced_at: updated?.synced_at ?? Date.now(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeCodeSyncErrorFile(targetDir, msg);
    return { ...base, error: msg };
  }
}

/** 按 `wiki_source` 代码库槽位同步到 `code_base/<categoryId>/<sourceType>/` */
export async function syncWikiCategoryCodeRepos(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
): Promise<WikiCategoryCodeRepoSyncResult> {
  const tokens = WIKI_QA_CLONE_TOKENS;
  const config = getWikiDocSourceConfigByCategory(db, categoryId);
  const sources: CodeRepoSyncItemResult[] = [];

  for (let i = 0; i < WIKI_CODE_REPO_SOURCE_TYPES.length; i++) {
    const row = config.code_repos[i];
    if (!row) {
      const sourceType = WIKI_CODE_REPO_SOURCE_TYPES[i];
      sources.push({
        id: "",
        source_type: sourceType,
        source_type_label: wikiSourceTypeLabel(sourceType),
        wiki_url: "",
        output_dir: `${CODE_BASE_DIR}/${categoryId}/${sourceType}`,
        synced_at: null,
        skipped: true,
        skip_reason: "未配置",
      });
      continue;
    }
    sources.push(await syncOneCodeRepoRow(db, categoryId, row, tokens));
  }

  return { category_id: categoryId, sources };
}

/** 按指定槽位同步代码库；可选 `branchOverride` 覆盖文档源配置分支 */
export async function syncWikiCategoryCodeRepoSlots(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
  slots: readonly WikiQaCodeRepoSlot[],
  options?: { branchOverride?: string },
): Promise<WikiCategoryCodeRepoSyncResult> {
  const tokens = WIKI_QA_CLONE_TOKENS;
  const config = getWikiDocSourceConfigByCategory(db, categoryId);
  const uniqueSlots = [...new Set(slots)].filter(isWikiQaCodeRepoSlot).sort((a, b) => a - b);
  const sources: CodeRepoSyncItemResult[] = [];

  for (const slot of uniqueSlots) {
    const row = getCodeRepoRowBySlot(config, slot);
    if (!row) {
      const sourceType = wikiCodeRepoSourceTypeForSlot(slot);
      sources.push({
        id: "",
        source_type: sourceType,
        source_type_label: wikiSourceTypeLabel(sourceType),
        wiki_url: "",
        output_dir: `${CODE_BASE_DIR}/${categoryId}/${sourceType}`,
        synced_at: null,
        skipped: true,
        skip_reason: "未配置",
      });
      continue;
    }
    sources.push(
      await syncOneCodeRepoRow(db, categoryId, row, tokens, options?.branchOverride),
    );
  }

  return { category_id: categoryId, sources };
}

/** 槽位序号（1-based）对应的配置标签，供错误提示 */
export function codeRepoSlotLabel(slot: number): string {
  if (slot >= 1 && slot <= WIKI_CODE_REPO_SOURCE_TYPES.length) {
    return wikiCodeRepoConfigLabel(slot as WikiQaCodeRepoSlot);
  }
  return `代码库 ${slot}`;
}
