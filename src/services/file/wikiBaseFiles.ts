import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { WIKI_BASE_DIR } from "../../constants/commonKey.js";
import { WIKI_CATEGORIES, isWikiCategoryId } from "../../constants/wikiCategory.js";
import {
  detectPreviewContentKind,
  type AiOutPreviewContentKind,
} from "./readLatestAiOutMarkdown.js";

export type WikiBaseFileItem = {
  /** 相对 `wiki_base/<categoryId>/` 的路径 */
  relative_path: string;
  /** 文件名（不含目录） */
  name: string;
  updated_at: number;
  size: number;
};

export type WikiBaseDirItem = {
  /** 相对 `wiki_base/<categoryId>/` 的路径 */
  relative_path: string;
  /** 目录名 */
  name: string;
};

/** 单层目录列表（不递归） */
export type WikiBaseDirListing = {
  category_id: string;
  /** 当前相对 `wiki_base/<categoryId>/` 的子目录；空字符串为分类根 */
  dir: string;
  directories: WikiBaseDirItem[];
  files: WikiBaseFileItem[];
};

export type WikiBaseCategorySummary = {
  id: string;
  label: string;
  file_count: number;
};

export type WikiBaseFileContent = {
  category_id: string;
  relative_path: string;
  content: string;
  content_kind: AiOutPreviewContentKind;
  updated_at: number;
};

const PREVIEWABLE_SUFFIXES = [".md", ".markdown", ".json", ".txt"] as const;

function isPreviewableFile(name: string): boolean {
  const lower = name.toLowerCase();
  return PREVIEWABLE_SUFFIXES.some((ext) => lower.endsWith(ext));
}

function contentKindForFile(name: string, content: string): AiOutPreviewContentKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".txt")) return detectPreviewContentKind(content);
  return "markdown";
}

function wikiBaseRoot(): string {
  return resolve(process.cwd(), WIKI_BASE_DIR);
}

function assertUnderWikiBaseRoot(absPath: string): void {
  const root = wikiBaseRoot();
  const normalized = resolve(absPath);
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error("path outside wiki_base");
  }
}

/** 分类 id 仅允许已定义的字面量（1–4） */
export function assertSafeWikiCategoryId(categoryId: string): void {
  if (!isWikiCategoryId(categoryId)) {
    throw new Error("invalid wiki category id");
  }
}

/** 相对路径不得含 `..` 或绝对路径成分 */
export function assertSafeWikiRelativePath(relPath: string): void {
  const t = relPath.trim();
  if (!t || t.includes("..") || t.startsWith("/") || t.includes("\\")) {
    throw new Error("invalid relative path");
  }
}

/** 浏览用相对目录路径；空字符串表示分类根 */
export function assertSafeWikiRelativeDir(relPath: string): void {
  const t = relPath.trim();
  if (t === "") return;
  if (t.includes("..") || t.startsWith("/") || t.includes("\\")) {
    throw new Error("invalid relative path");
  }
}

function isHiddenEntryName(name: string): boolean {
  return name.startsWith(".") || name.startsWith("_");
}

function collectFiles(dir: string, categoryRoot: string, out: WikiBaseFileItem[]): void {
  if (!existsSync(dir)) return;
  assertUnderWikiBaseRoot(dir);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      collectFiles(abs, categoryRoot, out);
      continue;
    }
    if (!ent.isFile() || !isPreviewableFile(ent.name)) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    out.push({
      relative_path: relative(categoryRoot, abs).replace(/\\/g, "/"),
      name: ent.name,
      updated_at: st.mtimeMs,
      size: st.size,
    });
  }
}

/** 列出全部分类及各自文件数量 */
export function listWikiBaseCategories(): WikiBaseCategorySummary[] {
  return WIKI_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    file_count: listWikiBaseFiles(c.id).length,
  }));
}

/** 列出 `wiki_base/<categoryId>/` 下全部可预览文件（递归，用于分类卡片计数） */
export function listWikiBaseFiles(categoryId: string): WikiBaseFileItem[] {
  assertSafeWikiCategoryId(categoryId);
  const categoryRoot = join(wikiBaseRoot(), categoryId);
  assertUnderWikiBaseRoot(categoryRoot);
  const files: WikiBaseFileItem[] = [];
  collectFiles(categoryRoot, categoryRoot, files);
  files.sort((a, b) => b.updated_at - a.updated_at);
  return files;
}

/** 列出 `wiki_base/<categoryId>/[dir]/` 当前一层子目录与可预览文件 */
export function listWikiBaseDir(categoryId: string, relativeDir = ""): WikiBaseDirListing {
  assertSafeWikiCategoryId(categoryId);
  assertSafeWikiRelativeDir(relativeDir);
  const categoryRoot = join(wikiBaseRoot(), categoryId);
  const dir = relativeDir.trim();
  const absDir = dir ? resolve(categoryRoot, dir) : categoryRoot;
  assertUnderWikiBaseRoot(absDir);
  if (!absDir.startsWith(categoryRoot + sep) && absDir !== categoryRoot) {
    throw new Error("invalid relative path");
  }

  const directories: WikiBaseDirItem[] = [];
  const files: WikiBaseFileItem[] = [];

  if (!existsSync(absDir)) {
    return { category_id: categoryId, dir, directories, files };
  }

  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return { category_id: categoryId, dir, directories, files };
  }

  for (const ent of entries) {
    if (isHiddenEntryName(ent.name)) continue;
    const abs = join(absDir, ent.name);
    const rel = relative(categoryRoot, abs).replace(/\\/g, "/");
    if (ent.isDirectory()) {
      directories.push({ name: ent.name, relative_path: rel });
      continue;
    }
    if (!ent.isFile() || !isPreviewableFile(ent.name)) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    files.push({
      relative_path: rel,
      name: ent.name,
      updated_at: st.mtimeMs,
      size: st.size,
    });
  }

  directories.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  files.sort((a, b) => b.updated_at - a.updated_at);
  return { category_id: categoryId, dir, directories, files };
}

/** 读取 `wiki_base/<categoryId>/` 下指定相对路径文件 */
export function readWikiBaseFile(categoryId: string, relativePath: string): WikiBaseFileContent | null {
  assertSafeWikiCategoryId(categoryId);
  assertSafeWikiRelativePath(relativePath);
  const categoryRoot = join(wikiBaseRoot(), categoryId);
  const absPath = resolve(categoryRoot, relativePath);
  assertUnderWikiBaseRoot(absPath);
  if (!absPath.startsWith(categoryRoot + sep) && absPath !== categoryRoot) {
    throw new Error("invalid relative path");
  }
  if (!existsSync(absPath)) return null;
  const st = statSync(absPath);
  if (!st.isFile() || !isPreviewableFile(relativePath)) return null;
  const content = readFileSync(absPath, "utf8");
  return {
    category_id: categoryId,
    relative_path: relativePath.replace(/\\/g, "/"),
    content,
    content_kind: contentKindForFile(relativePath, content),
    updated_at: st.mtimeMs,
  };
}
