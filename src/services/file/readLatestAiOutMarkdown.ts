import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { AI_OUT_DIR } from "../../constants/commonKey.js";
import { isTaskType, type TaskType } from "../../constants/taskType.js";
import { assertSafePathSegment } from "./aiOutTaskPath.js";

export type AiOutPreviewContentKind = "markdown" | "json" | "text";

export type LatestAiOutMarkdownResult = {
  pid: string;
  task_type: TaskType;
  /** 执行该 Agent 任务的 `tasks.id`（按 task_id 查询时有值） */
  task_id?: string;
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

function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

/**
 * 优先取 mtime 最新的 Markdown；无 md / markdown 时再按 mtime 取其他可预览文件。
 */
function pickPreferredLatest(candidates: FileCandidate[]): FileCandidate | null {
  if (candidates.length === 0) return null;
  const markdown = candidates.filter((c) => isMarkdownFile(c.relativePath));
  const pool = markdown.length > 0 ? markdown : candidates;
  return pool.reduce((best, cur) => (cur.mtimeMs > best.mtimeMs ? cur : best));
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

export type AiOutFileInfo = {
  /** 相对 `ai_out/<pid>/<taskType>/` 的路径 */
  relative_path: string;
  /** 文件 mtime（毫秒） */
  updated_at: number;
};

/** 列出 `ai_out/<pid>/<taskType>/` 下全部可预览文档（按 mtime 升序） */
export function listAiOutMarkdownFiles(pid: string, taskType: TaskType): AiOutFileInfo[] {
  assertSafePid(pid);
  const typeDir = join(aiOutRoot(), pid, String(taskType));
  assertUnderAiOutRoot(typeDir);

  const candidates: FileCandidate[] = [];
  collectPreviewableFiles(typeDir, typeDir, taskType, candidates);
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return candidates.map((c) => ({
    relative_path: c.relativePath,
    updated_at: c.mtimeMs,
  }));
}

/** 规范化并校验相对 `ai_out/<pid>/<taskType>/` 的路径 */
function normalizeAiOutRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("..")) {
    throw new Error("invalid relative path");
  }
  if (!isPreviewableFile(normalized)) {
    throw new Error("unsupported file type (only .md / .markdown / .json / .txt)");
  }
  return normalized;
}

/**
 * 解析 `ai_out/<pid>/<taskType>/<relativePath>` 绝对路径（须已存在且为可预览文件）。
 */
function resolveExistingAiOutPreviewFile(
  pid: string,
  taskType: TaskType,
  relativePath: string,
): { absPath: string; relativePath: string; typeDir: string } {
  assertSafePid(pid);
  const normalized = normalizeAiOutRelativePath(relativePath);
  const typeDir = join(aiOutRoot(), pid, String(taskType));
  const absPath = resolve(typeDir, normalized);
  assertUnderAiOutRoot(absPath);
  if (!absPath.startsWith(typeDir + sep) && absPath !== typeDir) {
    throw new Error("path outside ai_out task type dir");
  }
  if (!existsSync(absPath)) {
    throw new Error("file not found");
  }
  const st = statSync(absPath);
  if (!st.isFile()) {
    throw new Error("not a file");
  }
  return { absPath, relativePath: normalized, typeDir };
}

/**
 * 按相对路径读取 `ai_out/<pid>/<taskType>/` 下单个可预览文档。
 */
export function readAiOutFileByRelativePath(
  pid: string,
  taskType: TaskType,
  relativePath: string,
): LatestAiOutMarkdownResult | null {
  let resolved;
  try {
    resolved = resolveExistingAiOutPreviewFile(pid, taskType, relativePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "file not found" || msg === "not a file") return null;
    throw err;
  }
  const content = readFileSync(resolved.absPath, "utf8");
  const st = statSync(resolved.absPath);
  return {
    pid,
    task_type: taskType,
    relative_path: resolved.relativePath,
    content,
    content_kind: contentKindForFile(resolved.relativePath, content),
    updated_at: st.mtimeMs,
  };
}

/**
 * 按相对路径覆写 `ai_out/<pid>/<taskType>/` 下已有可预览文档（不允许新建路径）。
 */
export function writeAiOutFileByRelativePath(
  pid: string,
  taskType: TaskType,
  relativePath: string,
  content: string,
): LatestAiOutMarkdownResult {
  const resolved = resolveExistingAiOutPreviewFile(pid, taskType, relativePath);
  writeFileSync(resolved.absPath, content, "utf8");
  const st = statSync(resolved.absPath);
  return {
    pid,
    task_type: taskType,
    relative_path: resolved.relativePath,
    content,
    content_kind: contentKindForFile(resolved.relativePath, content),
    updated_at: st.mtimeMs,
  };
}

/**
 * 读取 `ai_out/<pid>/<taskType>/<taskId>/` 下优先最新的 Markdown；无 md 时取最新 json/txt。
 */
export function readAiOutMarkdownByTaskId(
  pid: string,
  taskType: TaskType,
  taskId: string,
): LatestAiOutMarkdownResult | null {
  assertSafePid(pid);
  assertSafePathSegment(taskId, "task id");
  const typeDir = join(aiOutRoot(), pid, String(taskType));
  const taskDir = join(typeDir, taskId);
  if (!existsSync(taskDir)) return null;
  assertUnderAiOutRoot(taskDir);

  const candidates: FileCandidate[] = [];
  collectPreviewableFiles(taskDir, typeDir, taskType, candidates);
  const latest = pickPreferredLatest(candidates);
  if (!latest) return null;

  const content = readFileSync(latest.absPath, "utf8");

  return {
    pid,
    task_type: taskType,
    task_id: taskId,
    relative_path: latest.relativePath,
    content,
    content_kind: contentKindForFile(latest.relativePath, content),
    updated_at: latest.mtimeMs,
  };
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
 * 读取 `ai_out/<pid>/<taskType>/` 下优先最新的 Markdown；无 md 时取最新 json/txt。
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

  const latest = pickPreferredLatest(candidates);
  if (!latest) return null;

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

const AI_OUT_ASSET_SUFFIXES = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"] as const;

function isAiOutAssetFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AI_OUT_ASSET_SUFFIXES.some((ext) => lower.endsWith(ext));
}

function mimeForAiOutAsset(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

/**
 * 读取 `ai_out/<pid>/<taskType>/` 下图片资源（如 UI 测试报告旁的 `ui_test_screenshots/`）。
 * `relativePath` 相对该 taskType 目录（可含 `taskId/` 前缀）。
 */
export function readAiOutAsset(
  pid: string,
  taskType: TaskType,
  relativePath: string,
): { buffer: Buffer; mime: string } | null {
  assertSafePid(pid);
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("..")) {
    throw new Error("invalid relative path");
  }
  if (!isAiOutAssetFile(normalized)) return null;

  const typeDir = join(aiOutRoot(), pid, String(taskType));
  const absPath = resolve(typeDir, normalized);
  assertUnderAiOutRoot(absPath);
  if (!absPath.startsWith(typeDir + sep) && absPath !== typeDir) {
    throw new Error("path outside ai_out task type dir");
  }
  if (!existsSync(absPath)) return null;
  const st = statSync(absPath);
  if (!st.isFile()) return null;
  return {
    buffer: readFileSync(absPath),
    mime: mimeForAiOutAsset(normalized),
  };
}
