import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { AI_OUT_DIR } from "../../constants/commonKey.js";
import { isTaskType, type TaskType } from "../../constants/taskType.js";

export type AiOutPreviewContentKind = "markdown" | "json" | "text";

export type LatestAiOutMarkdownResult = {
  pid: string;
  task_type: TaskType;
  /** 相对 `ai_out/<pid>/<taskType>/` 的路径 */
  relative_path: string;
  content: string;
  /** 预览渲染类型 */
  content_kind: AiOutPreviewContentKind;
  /** 文件 mtime（毫秒） */
  updated_at: number;
};

type FileCandidate = {
  taskType: TaskType;
  relativePath: string;
  absPath: string;
  mtimeMs: number;
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

/** 尝试解析 JSON；成功时返回解析结果，否则 `null` */
function tryParseJsonContent(content: string): unknown | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** 简单启发式：内容是否像 Markdown */
function looksLikeMarkdown(content: string): boolean {
  const t = content.trim();
  if (!t) return false;
  let signals = 0;
  for (const line of t.split(/\r?\n/).slice(0, 80)) {
    const s = line.trim();
    if (!s) continue;
    if (/^#{1,6}\s+\S/.test(s)) signals += 2;
    if (/^```/.test(s)) signals += 2;
    if (/^>\s+/.test(s)) signals += 1;
    if (/^\s*[-*+]\s+\S/.test(line)) signals += 1;
    if (/^\s*\d+\.\s+\S/.test(line)) signals += 1;
    if (/\[[^\]]+\]\([^)]+\)/.test(s)) signals += 1;
    if (/(\*\*|__).+?(\*\*|__)/.test(s)) signals += 1;
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(s)) signals += 1;
  }
  return signals >= 2;
}

/**
 * 按内容推断预览格式（用于 `.txt` 等扩展名无法区分格式的场景）。
 * 优先 JSON，其次 Markdown，否则纯文本。
 */
export function detectPreviewContentKind(content: string): AiOutPreviewContentKind {
  if (tryParseJsonContent(content) !== null) return "json";
  if (looksLikeMarkdown(content)) return "markdown";
  return "text";
}

/** 防止路径穿越：pid 仅允许常见安全字符 */
function assertSafePid(pid: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(pid)) {
    throw new Error("invalid pid");
  }
}

function aiOutRoot(): string {
  return resolve(process.cwd(), AI_OUT_DIR);
}

function assertUnderAiOutRoot(absPath: string): void {
  const root = aiOutRoot();
  const normalized = resolve(absPath);
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error("path outside ai_out");
  }
}

/** 递归收集目录下全部可预览文档（md / json / txt） */
function collectPreviewableFiles(
  dir: string,
  taskTypeRoot: string,
  taskType: TaskType,
  out: FileCandidate[],
): void {
  if (!existsSync(dir)) return;
  assertUnderAiOutRoot(dir);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      collectPreviewableFiles(abs, taskTypeRoot, taskType, out);
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
      taskType,
      relativePath: relative(taskTypeRoot, abs).replace(/\\/g, "/"),
      absPath: abs,
      mtimeMs: st.mtimeMs,
    });
  }
}

function listTaskTypeDirs(pidDir: string): TaskType[] {
  if (!existsSync(pidDir)) return [];
  assertUnderAiOutRoot(pidDir);
  const types: TaskType[] = [];
  for (const ent of readdirSync(pidDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const n = Number(ent.name);
    if (isTaskType(n)) types.push(n);
  }
  return types;
}

/** 列出 `ai_out/<pid>/` 下存在可预览文档的任务类型子目录 */
export function listAiOutMarkdownTaskTypes(pid: string): TaskType[] {
  assertSafePid(pid);
  const pidDir = join(aiOutRoot(), pid);
  assertUnderAiOutRoot(pidDir);
  const types = listTaskTypeDirs(pidDir);
  const withDocs: TaskType[] = [];
  for (const tt of types) {
    const candidates: FileCandidate[] = [];
    const typeDir = join(pidDir, String(tt));
    collectPreviewableFiles(typeDir, typeDir, tt, candidates);
    if (candidates.length > 0) withDocs.push(tt);
  }
  return withDocs.sort((a, b) => a - b);
}

/**
 * 读取 `ai_out/<pid>/<taskType>/` 下 mtime 最新的可预览文档（md / json / txt）。
 * `taskType` 省略时扫描该 pid 下全部任务类型子目录。
 */
export function readLatestAiOutMarkdown(
  pid: string,
  taskType?: TaskType,
): LatestAiOutMarkdownResult | null {
  assertSafePid(pid);
  const root = aiOutRoot();
  const pidDir = join(root, pid);
  assertUnderAiOutRoot(pidDir);

  const candidates: FileCandidate[] = [];
  const taskTypes =
    taskType !== undefined ? [taskType] : listTaskTypeDirs(pidDir);

  for (const tt of taskTypes) {
    const typeDir = join(pidDir, String(tt));
    collectPreviewableFiles(typeDir, typeDir, tt, candidates);
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = candidates[0]!;
  const content = readFileSync(latest.absPath, "utf8");

  return {
    pid,
    task_type: latest.taskType,
    relative_path: latest.relativePath,
    content,
    content_kind: contentKindForFile(latest.relativePath, content),
    updated_at: latest.mtimeMs,
  };
}
