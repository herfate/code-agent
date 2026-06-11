import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 拆分故事 Agent 输出的分隔符文件名 */
export const STORY_SPLIT_CHAR_BASENAME = "split_char.txt";

/** 允许的分隔符（与 task_type=9 init 提示词一致） */
export const STORY_SPLIT_HEADING_MARKERS = ["#", "##", "###", "####"] as const;

export type StorySplitHeadingMarker = (typeof STORY_SPLIT_HEADING_MARKERS)[number];

const STORY_SPLIT_HEADING_MARKER_SET = new Set<string>(STORY_SPLIT_HEADING_MARKERS);

/** 是否包含中文（CJK 统一汉字） */
export function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** 解析 `split_char.txt` 正文为合法 Markdown 标题分隔符 */
export function parseStorySplitHeadingMarker(raw: string): StorySplitHeadingMarker | null {
  const marker = raw.trim();
  if (STORY_SPLIT_HEADING_MARKER_SET.has(marker)) {
    return marker as StorySplitHeadingMarker;
  }
  return null;
}

/** 从任务仓库相对路径读取分隔符；失败返回 `null` */
export function parseStorySplitMarkerFromRepoFile(
  taskRepoCwd: string,
  relativePath: string,
): StorySplitHeadingMarker | null {
  try {
    const content = readFileSync(join(taskRepoCwd, relativePath), "utf8");
    return parseStorySplitHeadingMarker(content);
  } catch {
    return null;
  }
}

function scoreStorySplitChangedFilePath(p: string): number {
  const lower = p.toLowerCase();
  if (lower.endsWith(STORY_SPLIT_CHAR_BASENAME)) return 0;
  if (lower.includes("split_char")) return 1;
  return 2;
}

/** 优先 `split_char.txt`，否则按路径顺序尝试解析 */
export function parseStorySplitMarkerFromChangedFiles(
  taskRepoCwd: string,
  relativePaths: string[],
): StorySplitHeadingMarker | null {
  if (relativePaths.length === 0) return null;

  const sorted = [...relativePaths].sort(
    (a, b) => scoreStorySplitChangedFilePath(a) - scoreStorySplitChangedFilePath(b),
  );

  for (const rel of sorted) {
    const marker = parseStorySplitMarkerFromRepoFile(taskRepoCwd, rel);
    if (marker) return marker;
  }
  return null;
}

/**
 * 按 Markdown 标题前缀拆分正文（仅在行首匹配，如 `##` 不会误拆 `###`）。
 */
export function splitContentByHeadingMarker(content: string, marker: StorySplitHeadingMarker): string[] {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?=^${escaped}(?:\\s|$))`, "m");
  return content
    .split(re)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
