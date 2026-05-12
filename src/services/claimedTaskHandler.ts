import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { createAgentRun } from "../db/agentRun.js";
import {
  createThread,
  getThread,
  insertMessage,
  updateThreadExternalId,
} from "../db/repository.js";
import { TASK_STATUS, updateTask, type TaskRow } from "../db/workflow.js";
import { streamClaudeQueryToSse } from "./claudeAgent.js";
import { mergeTaskMetaWithClaudeRunId } from "./taskClaudeMeta.js";

/**
 * 定时扫描在将任务从待执行（1）原子认领为执行中（2）之后调用。
 * 使用任务 `description` 作为提示词调用 Claude Agent SDK，结束后写回状态与出参。
 */
export async function handleClaimedTask(
  db: DatabaseSync,
  task: TaskRow,
  log: FastifyBaseLogger,
): Promise<void> {
  // 步骤 1：从任务描述得到提示词，并准备写入 completed_at 等字段用的时间戳
  const prompt = task.description.trim();
  const t = () => Date.now();

  // 步骤 2：无有效提示词则直接失败，避免空跑 SDK
  if (!prompt) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "任务描述为空，无法执行 Agent",
    });
    log.warn({ taskId: task.id }, "claimed task: empty description");
    return;
  }

  // 开始进入 Agent 主流程（打结构化日志）
  log.info({ taskId: task.id, title: task.title }, "claimed task: running Claude agent");

  // 步骤 3：确保存在与任务绑定的 Claude 会话（thread）；无则新建，坏引用或 provider 不符则失败或换新线程
  let threadId = task.thread_id;
  if (!threadId) {
    threadId = randomUUID();
    createThread(db, { id: threadId, provider: "claude", title: task.title || "Task agent" });
    updateTask(db, task.id, { thread_id: threadId });
  } else {
    const th = getThread(db, threadId);
    if (!th) {
      threadId = randomUUID();
      createThread(db, { id: threadId, provider: "claude", title: task.title || "Task agent" });
      updateTask(db, task.id, { thread_id: threadId });
    } else if (th.provider !== "claude") {
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: "任务关联的会话 provider 不是 claude",
      });
      log.error({ taskId: task.id, threadId }, "claimed task: thread provider mismatch");
      return;
    }
  }

  // 步骤 4：把本次用户提示写入 messages，与对话线程对齐
  insertMessage(db, {
    id: randomUUID(),
    thread_id: threadId,
    role: "user",
    content: prompt,
  });

  // 步骤 5：读取线程上的 SDK 会话 id，供 Claude Agent 断点续跑（resume）
  const threadRow = getThread(db, threadId)!;
  const resumeSessionId = threadRow.external_thread_id ?? undefined;

  // 步骤 6：为本轮执行创建 agent_run，用于 agent_run_events 落库与前端按 run 续订 SSE
  const runId = randomUUID();
  createAgentRun(db, { id: runId, thread_id: threadId, provider: "claude" });

  // 步骤 7：把 runId 写入任务 meta_json（claudeAgentRunId），便于 GET …/tasks/:id/claude-agent-stream 仅用任务 id 续订
  const metaJson = mergeTaskMetaWithClaudeRunId(task.meta_json, runId);
  updateTask(db, task.id, { meta_json: metaJson });

  // 步骤 8：无 HTTP 回复、仅落库模式跑 Claude（与 POST /api/agents/claude/sse 同源逻辑）
  const { sessionId, assistantText, sdkError } = await streamClaudeQueryToSse(null, {
    threadId,
    prompt,
    model: undefined,
    resume: resumeSessionId,
    runRecorder: { db, runId },
  });

  // 步骤 9：组装任务出参 JSON（成功/失败分支都会写入 output_json 便于排查）
  const outputPayload = {
    assistantText: assistantText ?? "",
    sessionId: sessionId ?? null,
    runId,
  };

  // 步骤 10：若本轮拿到新的 SDK session_id，回写到 threads.external_thread_id，下次同线程可 resume
  if (sessionId) {
    updateThreadExternalId(db, threadId, sessionId);
  }

  // 步骤 11：SDK 报错或 result 非成功——写 system 消息、任务失败、带 output_json 退出
  if (sdkError) {
    if (assistantText) {
      insertMessage(db, {
        id: randomUUID(),
        thread_id: threadId,
        role: "assistant",
        content: assistantText,
      });
    }
    insertMessage(db, {
      id: randomUUID(),
      thread_id: threadId,
      role: "system",
      content: `error: ${sdkError}`,
    });
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: sdkError,
      output_json: JSON.stringify(outputPayload),
    });
    log.error({ taskId: task.id, err: sdkError }, "claimed task: Claude agent error");
    return;
  }

  // 步骤 12：成功——若有AI响应正文则写入 messages
  if (assistantText) {
    insertMessage(db, {
      id: randomUUID(),
      thread_id: threadId,
      role: "assistant",
      content: assistantText,
    });
  }

  // 步骤 13：任务标记完成并写入汇总出参
  updateTask(db, task.id, {
    status: TASK_STATUS.Completed,
    completed_at: t(),
    error_message: null,
    output_json: JSON.stringify(outputPayload),
  });
  log.info({ taskId: task.id, sessionId }, "claimed task: Claude agent finished");
}
