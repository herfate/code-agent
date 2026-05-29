import type { DatabaseSync } from "node:sqlite";
import { parentAgentTypeLabel } from "../../constants/parentAgentType.js";
import { TASK_STATUS } from "../../constants/taskStatus.js";
import { taskTypeLabel } from "../../constants/taskType.js";
import { getParentTask } from "../../db/parentTask.js";
import { getTask } from "../../db/workflow.js";
import { AppLog } from "../appLogger.js";
import { sendWecomTextWebhook } from "./wecomWebhook.js";

/** 企业微信文本消息建议上限，预留元信息行空间 */
const ASSISTANT_TEXT_MAX_LEN = 1500;

/** 从 output_json 解析 assistantText */
function parseAssistantTextFromOutput(outputJson: string | null): string {
  if (!outputJson?.trim()) return "";
  try {
    const parsed = JSON.parse(outputJson) as { assistantText?: unknown };
    const text = parsed.assistantText;
    return typeof text === "string" ? text.trim() : "";
  } catch {
    return "";
  }
}

function truncateAssistantText(text: string): string {
  if (text.length <= ASSISTANT_TEXT_MAX_LEN) return text;
  return `${text.slice(0, ASSISTANT_TEXT_MAX_LEN)}…(已截断)`;
}

/** 毫秒 → 中文可读耗时 */
function formatDurationMs(ms: number): string {
  if (ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}小时${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function resolveTaskDurationLabel(task: {
  started_at: number | null;
  completed_at: number | null;
}): string {
  if (task.started_at == null || task.completed_at == null) return "未知";
  return formatDurationMs(task.completed_at - task.started_at);
}

/**
 * 任务执行结束（成功或失败）：发送企业微信 Webhook 通用通知。
 * - 失败：附带 error_message
 * - 成功：附带 output_json.assistantText（测试预分析等会先落库为完成再改为已暂停，亦视为成功）
 */
export async function notifyTaskExecuteResult(
  db: DatabaseSync,
  parentTaskId: string,
  taskId: string,
): Promise<void> {
  const task = getTask(db, taskId);
  if (!task) {
    AppLog.logger.warn({ taskId }, "notifyTaskExecuteResult: task not found");
    return;
  }

  const isFailed = task.status === TASK_STATUS.Failed;
  const isSuccess =
    task.status === TASK_STATUS.Completed || task.status === TASK_STATUS.Paused;
  if (!isFailed && !isSuccess) {
    return;
  }

  const parent = getParentTask(db, parentTaskId);
  const parentTitle = parent?.title?.trim() || parentTaskId;
  const atPrefix = task.creator?.trim() ? `@${task.creator.trim()} ` : "";

  const lines = [
    `${atPrefix}${isFailed ? "任务执行失败" : "任务执行成功"}`,
    `父任务ID: ${parentTaskId}`,
    `父任务名称: ${parentTitle}`,
    `任务ID: ${taskId}`,
    `任务名称: ${task.title}`,
    `任务类型: ${taskTypeLabel(task.task_type)}`,
    `Agent类型: ${parent ? parentAgentTypeLabel(parent.task_type) : "—"}`,
    `耗时: ${resolveTaskDurationLabel(task)}`,
  ];

  if (isFailed) {
    lines.push(`失败原因: ${task.error_message?.trim() || "未知错误"}`);
  } else {
    const assistantText = truncateAssistantText(parseAssistantTextFromOutput(task.output_json));
    if (assistantText) {
      lines.push(`执行结果:\n${assistantText}`);
    }
  }

  await sendWecomTextWebhook(lines.join("\n"));
}
