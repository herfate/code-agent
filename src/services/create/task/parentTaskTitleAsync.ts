import type { DatabaseSync } from "node:sqlite";
import { applyAiTitleToPlaceholder } from "../../../constants/parentTask.js";
import { getParentTask, updateParentTask } from "../../../db/parentTask.js";
import { listTasksByPid } from "../../../db/workflow.js";
import { taskTypeLabel } from "../../../constants/taskType.js";
import { AppLog } from "../../appLogger.js";
import { chat } from "../../tools/openAiUtil.js";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

export function buildParentTaskTitleSource(parts: {
  requirement?: string;
  description?: string;
  app?: string;
  branch_version?: string;
}): string {
  return [
    parts.requirement?.trim(),
    parts.description?.trim(),
    parts.app?.trim() ? `应用: ${parts.app}` : undefined,
    parts.branch_version?.trim() ? `分支: ${parts.branch_version}` : undefined,
  ]
    .filter((s): s is string => !!s)
    .join("\n");
}

function normalizeAiTitle(summaryTitle: string): string {
  const t = summaryTitle.replace(/\r?\n/g, " ").trim();
  if (!t) throw new Error("AI 返回的标题为空");
  return `${t}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 基于需求文本调用 LLM 汇总标题（仅返回 AI 标题片段，不含占位前缀） */
export async function summarizeTitleFromSourceText(
  db: DatabaseSync,
  sourceText: string,
): Promise<string> {
  const text = sourceText.trim();
  if (!text) {
    throw new Error("sourceText 为空");
  }

  const prompt =
    "请基于以下需求汇总一个简洁任务标题，限制 40 字以内，只输出标题，不要解释：\n" + text;

  let lastErr: unknown;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const summaryTitle = await chat(prompt, db);
      return normalizeAiTitle(summaryTitle);
    } catch (ex) {
      lastErr = ex;
      if (i >= MAX_ATTEMPTS - 1) break;
      AppLog.logger.warn({ attempt: i + 1, err: ex }, "汇总标题失败，将重试");
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI 汇总标题失败");
}

/** 基于需求文本调用 LLM 汇总标题并写回 `parent_task.title`（失败保留占位标题） */
export async function summarizeParentTaskTitleAsync(
  db: DatabaseSync,
  pid: string,
  sourceText: string,
): Promise<void> {
  const text = sourceText.trim();
  if (!text) {
    AppLog.logger.warn({ pid }, "异步汇总父任务标题跳过：sourceText 为空");
    return;
  }

  try {
    const normalizedTitle = await summarizeTitleFromSourceText(db, text);
    const parent = getParentTask(db, pid);
    if (!parent) {
      AppLog.logger.warn({ pid }, "父任务不存在，跳过更新标题");
      return;
    }
    const finalTitle = applyAiTitleToPlaceholder(parent.title, normalizedTitle);
    updateParentTask(db, pid, { title: finalTitle });
    const tasks = listTasksByPid(db, pid);
    const now = Date.now();
    const stmt = db.prepare(`UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?`);
    for (const t of tasks) {
      stmt.run(`${finalTitle} - ${taskTypeLabel(t.task_type)}`, now, t.id);
    }
    AppLog.logger.info({ pid, title: finalTitle }, "异步汇总父任务标题成功");
  } catch (ex) {
    AppLog.logger.error({ pid, err: ex }, "异步汇总父任务标题失败，已达最大重试次数");
  }
}
