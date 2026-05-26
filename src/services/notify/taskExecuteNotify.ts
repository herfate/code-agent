import type { DatabaseSync } from "node:sqlite";
import { parentAgentTypeLabel } from "../../constants/parentAgentType.js";
import { taskTypeLabel } from "../../constants/taskType.js";
import { getParentTask } from "../../db/parentTask.js";
import { getTask } from "../../db/workflow.js";
import { AppLog } from "../appLogger.js";
import { sendWecomTextWebhook } from "./wecomWebhook.js";

/**
 * 任务执行失败：发送企业微信 Webhook 通用通知（不限任务类型）。
 */
export async function notifyTaskExecuteFailed(
  db: DatabaseSync,
  parentTaskId: string,
  taskId: string,
): Promise<void> {
  const task = getTask(db, taskId);
  if (!task) {
    AppLog.logger.warn({ taskId }, "notifyTaskExecuteFailed: task not found");
    return;
  }

  const parent = getParentTask(db, parentTaskId);
  const parentTitle = parent?.title?.trim() || parentTaskId;
  const atPrefix = task.creator?.trim() ? `@${task.creator.trim()} ` : "";
  const reason = task.error_message?.trim() || "未知错误";

  const lines = [
    `${atPrefix}任务执行失败`,
    `父任务ID: ${parentTaskId}`,
    `父任务名称: ${parentTitle}`,
    `任务ID: ${taskId}`,
    `任务名称: ${task.title}`,
    `任务类型: ${taskTypeLabel(task.task_type)}`,
    `失败原因: ${reason}`,
    `Agent类型: ${parent ? parentAgentTypeLabel(parent.task_type) : "—"}`,
  ];

  await sendWecomTextWebhook(lines.join("\n"));
}
