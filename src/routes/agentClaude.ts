import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDER } from "../constants/agentProvider.js";
import { createAgentRun } from "../db/agentRun.js";
import {
  createThread,
  getThread,
  insertMessage,
  updateThreadExternalId,
} from "../db/repository.js";
import { streamClaudeQueryToSse } from "../services/agentsdk/claudeAgent.js";
import { readAccessUserName } from "../services/accessLog.js";
import { switchClaudeAuthAccountFromDbAsync } from "../services/claude/updateClaudeJsonAuthToken.js";
import { resolveTaskRepoCwd, resolveTaskRepoPId } from "../services/file/aiOutTaskPath.js";
import { pipeAgentRunReplayToSse } from "../sse/replayAgentRun.js";

const bodySchema = z.object({
  threadId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  model: z.string().optional(),
  pId: z.string().max(200).optional(),
});

export function registerAgentClaudeRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/agents/claude/runs/:runId/stream", async (request, reply) => {
    const runIdParsed = z.string().uuid().safeParse((request.params as { runId?: string }).runId);
    if (!runIdParsed.success) {
      return reply.status(400).send({ error: "invalid runId" });
    }
    const q = (request.query as { afterSeq?: string }).afterSeq;
    const afterSeq = z.coerce.number().int().min(0).safeParse(q ?? 0);
    const after = afterSeq.success ? afterSeq.data : 0;
    await pipeAgentRunReplayToSse(reply, db, runIdParsed.data, after);
  });

  app.post("/api/agents/claude/sse", async (request, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(503).send({ error: "ANTHROPIC_API_KEY is not configured" });
    }

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { threadId: existingId, prompt, model, pId: bodyPId } = parsed.data;

    let threadId = existingId;
    if (!threadId) {
      threadId = crypto.randomUUID();
      createThread(db, { id: threadId, provider: AGENT_PROVIDER.Claude, title: "Claude chat" });
    } else {
      const t = getThread(db, threadId);
      if (!t) {
        return reply.status(404).send({ error: "Thread not found" });
      }
      if (t.provider !== AGENT_PROVIDER.Claude) {
        return reply.status(400).send({ error: "Thread provider mismatch" });
      }
    }

    insertMessage(db, {
      id: crypto.randomUUID(),
      thread_id: threadId,
      role: "user",
      content: prompt,
    });

    const threadRow = getThread(db, threadId);
    const resumeSessionId = threadRow?.external_thread_id ?? undefined;

    const runId = crypto.randomUUID();
    createAgentRun(db, { id: runId, thread_id: threadId, provider: AGENT_PROVIDER.Claude });

    reply.hijack();

    const headerUser = readAccessUserName(request.headers);
    const pId = resolveTaskRepoPId(bodyPId, headerUser);
    const taskRepoCwd = resolveTaskRepoCwd(pId);
    const authUsername =
      bodyPId?.trim() || (headerUser !== "-" ? headerUser.trim() : "") || undefined;

    // 智能问答 / 对话 SSE：按登录用户切换 Claude Auth Token（与认领任务一致）
    await switchClaudeAuthAccountFromDbAsync(db, taskRepoCwd, authUsername, request.log);

    const { sessionId, assistantText, sdkError } = await streamClaudeQueryToSse(reply, {
      threadId,
      pId,
      prompt,
      model,
      resume: resumeSessionId,
      runRecorder: { db, runId },
    });

    if (sessionId) {
      updateThreadExternalId(db, threadId, sessionId);
    }
    if (assistantText) {
      insertMessage(db, {
        id: crypto.randomUUID(),
        thread_id: threadId,
        role: "assistant",
        content: assistantText,
      });
    } else if (sdkError) {
      insertMessage(db, {
        id: crypto.randomUUID(),
        thread_id: threadId,
        role: "system",
        content: `error: ${sdkError}`,
      });
    }
  });
}
