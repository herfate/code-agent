import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { WikiCategoryId } from "../../constants/wikiCategory.js";
import type { WikiSourceType } from "../../constants/wikiSourceType.js";
import { wikiBaseCategorySourceDir } from "./writeWikiBaseMarkdown.js";

export type SavedWikiBaseJsonFile = {
  relative_path: string;
  absolute_path: string;
};

/** 清理目录名（与 Markdown 文件名规则一致） */
export function sanitizeWikiDirName(title: string, fallback: string): string {
  const s = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
  return s || fallback;
}

/** 写入 `wiki_base/<categoryId>/<sourceType>/<subDir>/<fileName>` */
export function saveWikiBaseJsonFile(
  categoryId: WikiCategoryId,
  sourceType: WikiSourceType,
  subDir: string,
  fileName: string,
  data: unknown,
): SavedWikiBaseJsonFile {
  const outDir = join(wikiBaseCategorySourceDir(categoryId, sourceType), subDir);
  mkdirSync(outDir, { recursive: true });
  const absolute_path = join(outDir, fileName);
  writeFileSync(absolute_path, JSON.stringify(data, null, 2) + "\n", "utf8");
  const categoryRoot = join(wikiBaseCategorySourceDir(categoryId, sourceType), "..");
  return {
    absolute_path,
    relative_path: relative(categoryRoot, absolute_path).replace(/\\/g, "/"),
  };
}
