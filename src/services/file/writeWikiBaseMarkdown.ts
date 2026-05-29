import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { WIKI_BASE_DIR } from "../../constants/commonKey.js";
import { isWikiCategoryId, type WikiCategoryId } from "../../constants/wikiCategory.js";
import { isWikiSourceType, type WikiSourceType } from "../../constants/wikiSourceType.js";
import type { ConfluenceMarkdownSavePayload } from "../tools/confluenceClient.js";

export type SavedWikiBasePageFile = {
  relative_path: string;
  absolute_path: string;
};

export function getWikiBaseRoot(): string {
  return resolve(process.cwd(), WIKI_BASE_DIR);
}

function assertWikiCategoryId(categoryId: string): asserts categoryId is WikiCategoryId {
  if (!isWikiCategoryId(categoryId)) {
    throw new Error("invalid wiki category id");
  }
}

function assertWikiSourceTypeDir(sourceType: string): asserts sourceType is WikiSourceType {
  if (!isWikiSourceType(sourceType)) {
    throw new Error("invalid wiki source type");
  }
}

function assertUnderWikiBaseRoot(absPath: string): void {
  const root = getWikiBaseRoot();
  const normalized = resolve(absPath);
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error("path outside wiki_base");
  }
}

/** `wiki_base/<categoryId>/<sourceType>/` 绝对路径 */
export function wikiBaseCategorySourceDir(categoryId: WikiCategoryId, sourceType: WikiSourceType): string {
  assertWikiCategoryId(categoryId);
  assertWikiSourceTypeDir(sourceType);
  const dir = join(getWikiBaseRoot(), categoryId, sourceType);
  assertUnderWikiBaseRoot(dir);
  return dir;
}

/** 同步前清空目标目录 */
export function clearWikiBaseCategorySourceDir(categoryId: WikiCategoryId, sourceType: WikiSourceType): void {
  const dir = wikiBaseCategorySourceDir(categoryId, sourceType);
  rmSync(dir, { recursive: true, force: true });
}

function sanitizeFileBaseName(title: string, fallback: string): string {
  const s = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
  return s || fallback;
}

function buildPageDocument(result: ConfluenceMarkdownSavePayload): string {
  const meta = [
    `Confluence pageId: ${result.pageId}`,
    result.spaceKey ? `space: ${result.spaceKey}` : "",
    `source: ${result.pageUrl}`,
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta}${result.markdown}\n`;
}

/** 写入 `wiki_base/<categoryId>/<sourceType>/{pageId}_{标题}.md`（不打包） */
export function saveWikiBaseMarkdownPage(
  result: ConfluenceMarkdownSavePayload,
  categoryId: WikiCategoryId,
  sourceType: WikiSourceType,
): SavedWikiBasePageFile {
  if (!/^\d+$/.test(result.pageId)) {
    throw new Error("invalid pageId");
  }
  const outDir = wikiBaseCategorySourceDir(categoryId, sourceType);
  mkdirSync(outDir, { recursive: true });
  const baseName = sanitizeFileBaseName(result.title, `page_${result.pageId}`);
  const fileName = `${result.pageId}_${baseName}.md`;
  const absolute_path = join(outDir, fileName);
  assertUnderWikiBaseRoot(absolute_path);
  writeFileSync(absolute_path, buildPageDocument(result), "utf8");
  const categoryRoot = join(getWikiBaseRoot(), categoryId);
  return {
    absolute_path,
    relative_path: relative(categoryRoot, absolute_path).replace(/\\/g, "/"),
  };
}
