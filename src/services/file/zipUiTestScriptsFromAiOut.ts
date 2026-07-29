import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import { ZipArchive } from "archiver";
import { AI_OUT_DIR } from "../../constants/commonKey.js";
import { TASK_TYPE } from "../../constants/taskType.js";
import { assertSafePathSegment } from "./aiOutTaskPath.js";
import { readLatestAiOutMarkdown } from "./readLatestAiOutMarkdown.js";

/** 打包时跳过的目录名（依赖 / 本地报告产物等；业务输出均保留） */
const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "test-results", "playwright-report"]);

export type ZipUiTestScriptsResult = {
  buffer: Buffer;
  /** 下载文件名 */
  filename: string;
  /** 打入 zip 的文件数 */
  fileCount: number;
  taskId: string;
};

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

/**
 * 从 `ai_out/<pid>/<taskType>/` 相对路径解析 taskId（首段）。
 * 例如 `abc123/ui_test_report.md` → `abc123`。
 */
export function taskIdFromAiOutRelativePath(relativePath: string): string | null {
  const first = String(relativePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)[0];
  if (!first || !/^[a-zA-Z0-9_-]+$/.test(first)) return null;
  // 根级常见输出名，不是 taskId
  if (
    first === "ui_test_report.md" ||
    first === "ui-tests" ||
    first === "ui_test_screenshots"
  ) {
    return null;
  }
  return first;
}

/** 递归收集目录下待打包文件（跳过 node_modules 等） */
function collectFilesForZip(dirAbs: string, out: string[]): void {
  if (!existsSync(dirAbs)) return;
  assertUnderAiOutRoot(dirAbs);
  for (const ent of readdirSync(dirAbs, { withFileTypes: true })) {
    if (ent.name === "." || ent.name === "..") continue;
    const abs = join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      collectFilesForZip(abs, out);
      continue;
    }
    if (ent.isFile()) out.push(abs);
  }
}

/** 将目录打成 zip Buffer；zip 内路径相对 sourceDir，根目录名为 rootName */
async function zipFilesToBuffer(
  sourceDir: string,
  fileAbsPaths: string[],
  rootName: string,
): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const passthrough = new PassThrough();
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolveBuf, reject) => {
    passthrough.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    passthrough.on("end", () => resolveBuf(Buffer.concat(chunks)));
    passthrough.on("error", reject);
    archive.on("error", reject);

    archive.pipe(passthrough);
    for (const abs of fileAbsPaths) {
      const rel = relative(sourceDir, abs).replace(/\\/g, "/");
      if (!rel || rel.startsWith("..")) continue;
      archive.file(abs, { name: `${rootName}/${rel}` });
    }
    archive.finalize();
  });
}

/**
 * 解析 UI 测试执行输出目录：`ai_out/<pid>/12/<taskId>/`。
 * 未传 taskId 时，取该 taskType 下最新预览文档所在 task 目录。
 */
export function resolveUiTestExecuteOutDir(
  pid: string,
  taskId?: string,
): { outDir: string; taskId: string } | null {
  assertSafePid(pid);
  const typeDir = join(aiOutRoot(), pid, String(TASK_TYPE.UiTestExecute));
  assertUnderAiOutRoot(typeDir);
  if (!existsSync(typeDir)) return null;

  let resolvedTaskId = taskId?.trim() || "";
  if (resolvedTaskId) {
    assertSafePathSegment(resolvedTaskId, "task id");
  } else {
    const latest = readLatestAiOutMarkdown(pid, TASK_TYPE.UiTestExecute);
    if (!latest) return null;
    const fromPath = taskIdFromAiOutRelativePath(latest.relative_path);
    if (!fromPath) return null;
    resolvedTaskId = fromPath;
  }

  const outDir = join(typeDir, resolvedTaskId);
  assertUnderAiOutRoot(outDir);
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
    return null;
  }
  return { outDir, taskId: resolvedTaskId };
}

/**
 * 将 `ai_out/<pid>/12/<taskId>/` 下全部产物打包为 zip（排除 node_modules 等依赖目录）。
 * 无输出目录或无可打包文件时返回 `null`。
 */
export async function zipUiTestScriptsFromAiOut(
  pid: string,
  taskId?: string,
): Promise<ZipUiTestScriptsResult | null> {
  const resolved = resolveUiTestExecuteOutDir(pid, taskId);
  if (!resolved) return null;

  const files: string[] = [];
  collectFilesForZip(resolved.outDir, files);
  if (files.length === 0) return null;

  const rootName = `ui-test-execute_${resolved.taskId}`;
  const buffer = await zipFilesToBuffer(resolved.outDir, files, rootName);
  const filename = `ui-test-execute_${pid}_${resolved.taskId}.zip`;

  return {
    buffer,
    filename,
    fileCount: files.length,
    taskId: resolved.taskId,
  };
}
