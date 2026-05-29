import type { DatabaseSync } from "node:sqlite";
import {
  getTask,
  TASK_STATUS,
  type TaskStatus,
  updateTask,
  type TaskRow,
} from "../../db/workflow.js";
import { pushFollowUpMessageToTaskMeta } from "../taskFollowUpPrompt.js";

/** 允许追加对话的任务状态 */
export const TASK_FOLLOW_UP_ALLOWED_STATUSES: TaskStatus[] = [
  TASK_STATUS.Completed,
  TASK_STATUS.Failed,
  TASK_STATUS.Paused,
  TASK_STATUS.Cancelled,
];

export type AppendTaskFollowUpResult =
  | { ok: true; task: TaskRow }
  | { ok: false; status: 404 | 409; error: string };

/**
 * 追加一条对话到 `meta_json.followUpMessages`，设为待执行并清空上轮执行结果字段；
 * 保留 `cursorAgentRunId` / `claudeAgentRunId`。
 */
export function appendTaskFollowUp(
  db: DatabaseSync,
  taskId: string,
  message: string,
): AppendTaskFollowUpResult {
  const existing = getTask(db, taskId);
  if (!existing) {
    return { ok: false, status: 404, error: "task not found" };
  }
  if (!TASK_FOLLOW_UP_ALLOWED_STATUSES.includes(existing.status)) {
    return {
      ok: false,
      status: 409,
      error: "仅可在执行完成、失败、已暂停或已取消后追加对话",
    };
  }

  const nextMetaJson = pushFollowUpMessageToTaskMeta(existing.meta_json, message);
  const updated = updateTask(db, taskId, {
    status: TASK_STATUS.Pending,
    error_message: null,
    output_json: null,
    started_at: null,
    completed_at: null,
    meta_json: nextMetaJson,
  });
  if (!updated) {
    return { ok: false, status: 404, error: "task not found" };
  }
  return { ok: true, task: updated };
}
