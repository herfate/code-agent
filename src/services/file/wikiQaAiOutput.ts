import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { assertSafeTaskRepoDirName } from "./aiOutTaskPath.js";
import { listTaskRepoFilesModifiedSince } from "./scanTaskRepoModifiedSince.js";

/** 记录复制完成时刻的 marker 文件名（相对工作区根） */
export const WIKI_QA_COPIED_SINCE_MARKER = ".wiki_qa_copied_since";

/** 用户上传文件名清单（JSON 字符串数组，排除出 AI 输出列表） */
export const WIKI_QA_USER_UPLOADS_MARKER = ".wiki_qa_user_uploads";

/** 单文件上传大小上限（字节） */
export const WIKI_QA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** 校验并规范化智能问答工作区用户名（`task-repo/<username>/`） */
export function normalizeWikiQaUsername(raw: string): string {
  const username = raw.trim();
  if (!username || username === "-") {
    throw new Error("获取当前登录用户失败");
  }
  assertSafeTaskRepoDirName(username, "username");
  return username;
}

export function wikiQaWorkspaceDir(username: string): string {
  return resolve(process.cwd(), "task-repo", normalizeWikiQaUsername(username));
}

/** 写入复制完成时间戳（毫秒） */
export function writeWikiQaCopiedSinceMarker(cwd: string, sinceMs: number): void {
  writeFileSync(join(cwd, WIKI_QA_COPIED_SINCE_MARKER), String(sinceMs), "utf8");
}

/** 读取 marker 中的复制完成时间戳；未准备过则 `null` */
export function readWikiQaCopiedSinceMs(username: string, cwd?: string): number | null {
  const root = cwd ?? wikiQaWorkspaceDir(username);
  const marker = join(root, WIKI_QA_COPIED_SINCE_MARKER);
  if (!existsSync(marker)) return null;
  const n = Number(readFileSync(marker, "utf8").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

const QA_OUTPUT_SKIP_NAMES = new Set([WIKI_QA_COPIED_SINCE_MARKER, WIKI_QA_USER_UPLOADS_MARKER]);

function assertSafeRelativePath(relPath: string): string {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  if (!norm || norm.includes("..") || norm.startsWith("/")) {
    throw new Error("invalid path");
  }
  return norm;
}

function assertUnderWikiQaWorkspace(absPath: string, username: string): void {
  const root = wikiQaWorkspaceDir(username);
  const normalized = resolve(absPath);
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error("path outside wiki qa workspace");
  }
}

/** 规范化上传文件名：仅保留 basename，禁止路径穿越与控制字符 */
export function sanitizeWikiQaUploadFilename(raw: string): string {
  const name = basename(String(raw || "").replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!name || name === "." || name === ".." || name.startsWith(".")) {
    throw new Error("invalid filename");
  }
  if (name.length > 200) {
    throw new Error("filename too long");
  }
  return name;
}

function readWikiQaUserUploadNames(username: string): Set<string> {
  const marker = join(wikiQaWorkspaceDir(username), WIKI_QA_USER_UPLOADS_MARKER);
  if (!existsSync(marker)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(marker, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string" && x.length > 0));
  } catch {
    return new Set();
  }
}

function appendWikiQaUserUploadName(username: string, name: string): void {
  const names = readWikiQaUserUploadNames(username);
  names.add(name);
  writeFileSync(
    join(wikiQaWorkspaceDir(username), WIKI_QA_USER_UPLOADS_MARKER),
    JSON.stringify([...names]),
    "utf8",
  );
}

export type WikiQaUploadResult = {
  name: string;
  size: number;
  absolute_path: string;
};

/**
 * 将上传文件保存到智能问答工作区根目录（`task-repo/<username>/<filename>`）。
 * 须先完成 prepare-qa；同名文件覆盖。
 */
export function saveWikiQaUploadToWorkspaceRoot(
  username: string,
  filename: string,
  data: Buffer,
): WikiQaUploadResult {
  if (readWikiQaCopiedSinceMs(username) == null) {
    throw new Error("请先完成智能问答工作区准备");
  }
  if (data.byteLength > WIKI_QA_UPLOAD_MAX_BYTES) {
    throw new Error(`file too large (max ${WIKI_QA_UPLOAD_MAX_BYTES} bytes)`);
  }
  const safeName = sanitizeWikiQaUploadFilename(filename);
  const root = wikiQaWorkspaceDir(username);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  const absPath = resolve(root, safeName);
  assertUnderWikiQaWorkspace(absPath, username);
  if (dirname(absPath) !== root) {
    throw new Error("invalid filename");
  }
  writeFileSync(absPath, data);
  appendWikiQaUserUploadName(username, safeName);
  return {
    name: safeName,
    size: data.byteLength,
    absolute_path: absPath,
  };
}

/** 列出 mtime 严格大于 `sinceMs` 的 AI 输出文件（排除 marker、用户上传等） */
export function listWikiQaAiOutputFiles(sinceMs: number, username: string, cwd?: string): string[] {
  const root = cwd ?? wikiQaWorkspaceDir(username);
  const userUploads = readWikiQaUserUploadNames(username);
  const files = listTaskRepoFilesModifiedSince(root, sinceMs);
  return files.filter((rel) => {
    const base = rel.split("/")[0] ?? rel;
    if (QA_OUTPUT_SKIP_NAMES.has(base) || QA_OUTPUT_SKIP_NAMES.has(rel)) return false;
    // 工作区根目录用户上传不计入 AI 输出
    if (!rel.includes("/") && userUploads.has(rel)) return false;
    return true;
  });
}

export type WikiQaAiOutputFileRef = {
  absolute_path: string;
  relative_path: string;
  name: string;
  size: number;
  updated_at: number;
};

/** 解析可下载的 AI 输出单文件（须在允许列表内） */
export function resolveWikiQaAiOutputFile(
  sinceMs: number,
  username: string,
  relPath: string,
): WikiQaAiOutputFileRef | null {
  const safe = assertSafeRelativePath(relPath);
  const allowed = listWikiQaAiOutputFiles(sinceMs, username);
  if (!allowed.includes(safe)) return null;

  const absPath = resolve(wikiQaWorkspaceDir(username), safe);
  assertUnderWikiQaWorkspace(absPath, username);
  if (!existsSync(absPath)) return null;

  const st = statSync(absPath);
  if (!st.isFile()) return null;

  return {
    absolute_path: absPath,
    relative_path: safe,
    name: basename(safe),
    size: st.size,
    updated_at: st.mtimeMs,
  };
}
