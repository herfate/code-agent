import { join } from "node:path";
import { AI_OUT_DIR } from "../../constants/commonKey.js";
import type { TaskType } from "../../constants/taskType.js";

/** 路径段安全校验（pid / task id 等） */
export function assertSafePathSegment(segment: string, label: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(segment)) {
    throw new Error(`invalid ${label}`);
  }
}

/** `task-repo/<name>/` 目录名：允许登录名常见字符（含 `.`），禁止路径分隔与 `..` */
export function assertSafeTaskRepoDirName(name: string, label: string): void {
  const segment = name.trim();
  if (!segment || segment === "." || segment === ".." || /[\\/]/.test(segment)) {
    throw new Error(`invalid ${label}`);
  }
  if (!/^[a-zA-Z0-9._@-]+$/.test(segment)) {
    throw new Error(`invalid ${label}`);
  }
}

/** 认领任务工作区目录名：`task-repo/<pid>_<workspaceId>/` */
export function buildClaimedTaskRepoDirName(parentTaskId: string, workspaceId: string): string {
  assertSafePathSegment(parentTaskId, "pid");
  assertSafePathSegment(workspaceId, "workspace id");
  return `${parentTaskId}_${workspaceId}`;
}

/** `task-repo/<dirName>/` 绝对路径（dirName 为 pid、username 或 pid_uuid） */
export function resolveTaskRepoCwd(dirName: string): string {
  assertSafeTaskRepoDirName(dirName, "task repo dir");
  return join(process.cwd(), "task-repo", dirName);
}

/** 解析 `task-repo/<pId>/` 目录名：优先 body，否则登录用户名；均未配置时回退 `demo` */
export function resolveTaskRepoPId(preferred: string | undefined, fallbackUserName: string): string {
  const raw = (preferred?.trim() || fallbackUserName).trim();
  if (!raw || raw === "-") return "demo";
  assertSafeTaskRepoDirName(raw, "pId");
  return raw;
}

/**
 * ai_out 相对路径（相对 `ai_out/<pid>/<taskType>/`）：
 * `{taskId}/{repoRelativePath}`，不再使用时间戳文件名。
 */
export function resolveAiOutStoredRelativePath(taskId: string, relativePath: string): string {
  assertSafePathSegment(taskId, "task id");
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error("invalid relative path");
  }
  return `${taskId}/${normalized}`;
}

/** `ai_out/<pid>/<taskType>/` 绝对路径 */
export function resolveAiOutTaskTypeDir(pid: string, taskType: TaskType): string {
  assertSafePathSegment(pid, "pid");
  return join(process.cwd(), AI_OUT_DIR, pid, String(taskType));
}

/** `ai_out/<pid>/<taskType>/<taskId>/` 绝对路径 */
export function resolveAiOutTaskDir(pid: string, taskType: TaskType, taskId: string): string {
  assertSafePathSegment(taskId, "task id");
  return join(resolveAiOutTaskTypeDir(pid, taskType), taskId);
}
