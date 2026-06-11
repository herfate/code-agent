import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { containsChinese } from "./parseTaskOutStorySplitResult.js";

/** AI 拆分故事输出文件名：story_1.md、story_2.md … */
const STORY_MD_BASENAME_RE = /^story_(\d+)\.md$/i;

export type AiStorySplitFragment = {
  /** 文件序号 N（来自 story_N.md） */
  index: number;
  /** 相对任务仓库的路径 */
  relativePath: string;
  /** 文件正文 */
  content: string;
};

function parseStoryMdBasename(fileName: string): number | null {
  const m = STORY_MD_BASENAME_RE.exec(fileName);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 从变更相对路径中收集 story_N.md，按 N 升序读取正文（含中文且非空） */
export function parseAiStorySplitFragmentsFromChangedFiles(
  taskRepoCwd: string,
  relativePaths: string[],
): AiStorySplitFragment[] {
  const candidates: { index: number; relativePath: string }[] = [];
  const seen = new Set<number>();

  for (const rel of relativePaths) {
    const name = basename(rel.replace(/\\/g, "/"));
    const index = parseStoryMdBasename(name);
    if (index === null || seen.has(index)) continue;
    seen.add(index);
    candidates.push({ index, relativePath: rel });
  }

  candidates.sort((a, b) => a.index - b.index);

  const fragments: AiStorySplitFragment[] = [];
  for (const c of candidates) {
    try {
      const content = readFileSync(join(taskRepoCwd, c.relativePath), "utf8").trim();
      if (!content || !containsChinese(content)) continue;
      fragments.push({
        index: c.index,
        relativePath: c.relativePath,
        content,
      });
    } catch {
      // 忽略读失败的文件
    }
  }
  return fragments;
}
