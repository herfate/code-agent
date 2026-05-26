import type { DatabaseSync } from "node:sqlite";
import { parentAgentTypeLabel } from "../../constants/parentAgentType.js";
import { getParentTask } from "../../db/parentTask.js";
import { getTask } from "../../db/workflow.js";
import { AppLog } from "../appLogger.js";
import { sendWecomTextWebhook } from "./wecomWebhook.js";

/** 文档预览 */
const FILE_PREVIEW_BASE = "todo";

/**
 * 测试案例执行结束：发送企业微信 Webhook 通知（无论通过率是否 100%）。
 */
export async function notifyTestCaseExecuteResult(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskId: string,
  creator: string | null,
  passRate: number,
  summary?: string,
): Promise<void> {
  const executing = getTask(db, executingTaskId);
  if (!executing) {
    AppLog.logger.warn({ executingTaskId }, "notifyTestCaseExecuteResult: task not found");
    return;
  }

  const parent = getParentTask(db, parentTaskId);
  const parentTitle = parent?.title?.trim() || parentTaskId;
  const atPrefix = creator?.trim() ? `@${creator.trim()} ` : "";
  const title = `${atPrefix}测试案例执行完成`;
  const statusLine =
    passRate === 100 ? "执行状态: 已通过（100%）" : `执行状态: 未全通过（${passRate}%），需修复后重试`;

  const lines = [
    title,
    `父任务ID: ${parentTaskId}`,
    `父任务名称: ${parentTitle}`,
    `任务ID: ${executingTaskId}`,
    `任务名称: ${executing.title}`,
    `测试通过率: ${passRate}%`,
    statusLine,
    `Agent类型: ${parent ? parentAgentTypeLabel(parent.task_type) : "—"}`,
  ];
  if (summary?.trim()) {
    lines.push("", "测试总结简述：", summary.trim());
  }
  lines.push("", `文档预览链接: ${FILE_PREVIEW_BASE}?taskId=${executingTaskId}`);

  await sendWecomTextWebhook(lines.join("\n"));
}
