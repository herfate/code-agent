import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import {
  createThread,
  getThread,
  insertMessage,
  updateThreadExternalId,
} from "../db/repository.js";
import { streamCodexTurnToSse } from "../services/codexAgent.js";

const bodySchema = z.object({
  threadId: z.string().uuid().optional(),
  prompt: z.string().min(1),
  model: z.string().optional(),
});

export function registerAgentCodexRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.post("/api/agents/codex/sse", async (request, reply) => {
    if (!process.env.OPENAI_API_KEY) {
      return reply.status(503).send({ error: "OPENAI_API_KEY is not configured" });
    }

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { threadId: existingId, prompt, model } = parsed.data;

    let threadId = existingId;
    if (!threadId) {
      threadId = crypto.randomUUID();
      createThread(db, { id: threadId, provider: "codex", title: "Codex chat" });
    } else {
      const t = getThread(db, threadId);
      if (!t) {
        return reply.status(404).send({ error: "Thread not found" });
      }
      if (t.provider !== "codex") {
        return reply.status(400).send({ error: "Thread provider mismatch" });
      }
    }

    insertMessage(db, {
      id: crypto.randomUUID(),
      thread_id: threadId,
      role: "user",
      content: prompt,
    });

    const row = getThread(db, threadId);
    const resumeThreadId = row?.external_thread_id ?? undefined;

    reply.hijack();

    const { codexThreadId, assistantText, error } = await streamCodexTurnToSse(reply, {
      threadId,
      apiKey: process.env.OPENAI_API_KEY,
      codexPathOverride: process.env.CODEX_PATH || undefined,
      prompt,
      model,
      resumeThreadId: resumeThreadId ?? undefined,
    });

    if (codexThreadId) {
      updateThreadExternalId(db, threadId, codexThreadId);
    }
    if (assistantText) {
      insertMessage(db, {
        id: crypto.randomUUID(),
        thread_id: threadId,
        role: "assistant",
        content: assistantText,
      });
    } else if (error) {
      insertMessage(db, {
        id: crypto.randomUUID(),
        thread_id: threadId,
        role: "system",
        content: `error: ${error}`,
      });
    }
  });
}
