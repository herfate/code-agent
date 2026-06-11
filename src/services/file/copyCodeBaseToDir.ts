import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CODE_BASE_DIR } from "../../constants/commonKey.js";
import { isWikiCategoryId, type WikiCategoryId } from "../../constants/wikiCategory.js";
import {
  isWikiQaCodeRepoSlot,
  wikiCodeRepoSourceTypeForSlot,
  type WikiQaCodeRepoSlot,
} from "../../constants/wikiSourceType.js";
import { getWikiDocSourceConfigByCategory, getCodeRepoRowBySlot } from "../../db/wikiSource.js";
import type { GitRepoInitPair } from "../../db/gitRepoPair.js";
import { parseCodeRepoWikiUrl } from "../wiki/codeRepoWikiSource.js";
import { codeBaseCategorySourceDir } from "../wiki/codeRepoSyncService.js";
import { planWikiQaCloneDirs } from "../tools/gitRepoWorkspace.js";
import { assertSafeWikiCategoryId } from "./wikiBaseFiles.js";

/** 复制到工作区时排除的目录名（小写比较） */
export const CODE_BASE_COPY_EXCLUDE_DIRS = new Set([
  ".git",
  ".claude",
  "node_modules",
  "target",
  "build",
  "dist",
  ".gradle",
  ".idea",
  ".vscode",
  "out",
  "__pycache__",
  ".next",
  "coverage",
]);

function shouldSkipCopyEntry(name: string): boolean {
  return CODE_BASE_COPY_EXCLUDE_DIRS.has(name.toLowerCase());
}

/** 统计目录下文件数（不含被排除的子目录） */
function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const name of readdirSync(dir)) {
    if (shouldSkipCopyEntry(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      count += countFilesRecursive(full);
    } else if (st.isFile()) {
      count++;
    }
  }
  return count;
}

/** 目录存在且含至少一个非排除文件 */
export function isCodeBaseSlotReady(categoryId: string, slot: WikiQaCodeRepoSlot): boolean {
  assertSafeWikiCategoryId(categoryId);
  const sourceType = wikiCodeRepoSourceTypeForSlot(slot);
  const srcDir = codeBaseCategorySourceDir(categoryId as WikiCategoryId, sourceType);
  return countFilesRecursive(srcDir) > 0;
}

function copyCodeBaseDirToTarget(srcDir: string, destDir: string): number {
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, {
    recursive: true,
    force: true,
    filter: (src, _dest) => {
      const rel = src.slice(srcDir.length).replace(/^[/\\]+/, "");
      if (!rel) return true;
      const top = rel.split(/[/\\]/)[0] ?? "";
      return !shouldSkipCopyEntry(top);
    },
  });
  return countFilesRecursive(destDir);
}

/**
 * 将 `code_base/<categoryId>/` 下指定槽位的代码复制到目标目录的子文件夹。
 * 要求对应 `wiki_source` 行已同步（`synced_at` 非空且目录有内容）。
 */
export function copyCodeRepoSlotsToDir(
  db: DatabaseSync,
  categoryId: string,
  targetDir: string,
  slots: readonly WikiQaCodeRepoSlot[],
): number {
  assertSafeWikiCategoryId(categoryId);
  const uniqueSlots = [...new Set(slots)].filter(isWikiQaCodeRepoSlot).sort((a, b) => a - b);
  if (uniqueSlots.length === 0) return 0;

  const config = getWikiDocSourceConfigByCategory(db, categoryId as WikiCategoryId);
  const repos: GitRepoInitPair[] = [];
  for (const slot of uniqueSlots) {
    const row = getCodeRepoRowBySlot(config, slot);
    if (!row?.wiki_url.trim()) {
      throw new Error(`代码库 ${slot} 未配置，请先在「文档源配置」中填写`);
    }
    if (row.synced_at == null) {
      throw new Error(`代码库 ${slot} 尚未同步，请先点击「立即同步」`);
    }
    const pair = parseCodeRepoWikiUrl(row.wiki_url);
    if (!pair?.gitRemoteUrl) {
      throw new Error(`代码库 ${slot} 地址格式无效`);
    }
    if (!isCodeBaseSlotReady(categoryId, slot)) {
      throw new Error(`代码库 ${slot} 尚未同步，请先点击「立即同步」`);
    }
    repos.push(pair);
  }

  const plans = planWikiQaCloneDirs(repos);
  const destRoot = resolve(targetDir);
  mkdirSync(destRoot, { recursive: true });

  let copied = 0;
  for (let i = 0; i < uniqueSlots.length; i++) {
    const slot = uniqueSlots[i];
    const plan = plans[i];
    const sourceType = wikiCodeRepoSourceTypeForSlot(slot);
    const srcDir = codeBaseCategorySourceDir(categoryId as WikiCategoryId, sourceType);
    const destDir = join(destRoot, plan.relDir);
    copied += copyCodeBaseDirToTarget(srcDir, destDir);
  }

  return copied;
}

/** 相对项目根的 code_base 路径（展示用） */
export function codeBaseRelPath(categoryId: string, sourceType: string): string {
  return `${CODE_BASE_DIR}/${categoryId}/${sourceType}`;
}
