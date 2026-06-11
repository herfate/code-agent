import type { TaskRow } from "../../db/workflow.js";
import { isToolTaskType } from "../../constants/taskType.js";

/** handleClaimedTask 非 cancelled 异常时的最大重试次数（不含首次执行） */
export const CLAIMED_TASK_MAX_RETRIES = 3;
export const CLAIMED_TASK_RETRY_DELAY_MS = 1000;

export function isCancelledErrorMessage(message: string): boolean {
  return message.trim().toLowerCase() === "cancelled";
}

/** 用户/客户端主动取消，不应重试 */
export function isCancelledTaskError(e: unknown): boolean {
  if (e instanceof Error) {
    if (e.name === "AbortError") return true;
    if (isCancelledErrorMessage(e.message)) return true;
  }
  return false;
}

/** 工具任务与 cancelled 异常不重试 */
export function shouldRetryClaimedTask(task: TaskRow, e: unknown): boolean {
  if (isToolTaskType(task.task_type)) return false;
  if (isCancelledTaskError(e)) return false;
  return true;
}
