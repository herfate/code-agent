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
import { streamCursorQueryToSse } from "../services/agentsdk/cursorAgent.js";
import { pipeAgentRunReplayToSse } from "../sse/replayAgentRun.js";

const bodySchema = z.object({
  threadId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  model: z.string().optional(),
});

export function registerAgentCursorRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/agents/cursor/runs/:runId/stream", async (request, reply) => {
    const runIdParsed = z.string().uuid().safeParse((request.params as { runId?: string }).runId);
    if (!runIdParsed.success) {
      return reply.status(400).send({ error: "invalid runId" });
    }
    const q = (request.query as { afterSeq?: string }).afterSeq;
    const afterSeq = z.coerce.number().int().min(0).safeParse(q ?? 0);
    const after = afterSeq.success ? afterSeq.data : 0;
    await pipeAgentRunReplayToSse(reply, db, runIdParsed.data, after);
  });

  app.post("/api/agents/cursor/sse", async (request, reply) => {
    const apiKey = process.env.CURSOR_API_KEY;
    if (!apiKey) {
      return reply.status(503).send({ error: "CURSOR_API_KEY is not configured" });
    }

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { threadId: existingId, prompt, model } = parsed.data;

    let threadId = existingId;
    if (!threadId) {
      threadId = crypto.randomUUID();
      createThread(db, { id: threadId, provider: AGENT_PROVIDER.Cursor, title: "Cursor chat" });
    } else {
      const t = getThread(db, threadId);
      if (!t) {
        return reply.status(404).send({ error: "Thread not found" });
      }
      if (t.provider !== AGENT_PROVIDER.Cursor) {
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
    const resumeAgentId = threadRow?.external_thread_id ?? undefined;

    const runId = crypto.randomUUID();
    createAgentRun(db, { id: runId, thread_id: threadId, provider: AGENT_PROVIDER.Cursor });

    reply.hijack();

    const { agentId, assistantText, sdkError } = await streamCursorQueryToSse(reply, {
      threadId,
      pId: "demo",
      prompt,
      apiKey,
      model,
      resume: resumeAgentId,
      runRecorder: { db, runId },
    });

    if (agentId) {
      updateThreadExternalId(db, threadId, agentId);
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
