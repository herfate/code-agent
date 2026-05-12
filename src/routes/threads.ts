import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { getThread, listMessages, listThreads, createThread, insertMessage } from "../db/repository.js";

const createThreadBody = z.object({
  title: z.string().max(500).optional(),
  provider: z.enum(["claude", "codex"]),
});

export function registerThreadRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/threads", async () => {
    return { threads: listThreads(db) };
  });

  app.post("/api/threads", async (request, reply) => {
    const parsed = createThreadBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const id = crypto.randomUUID();
    const row = createThread(db, { id, title: parsed.data.title, provider: parsed.data.provider });
    return reply.status(201).send({ thread: row });
  });

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/api/threads/:id/messages", async (request, reply) => {
    const { id } = request.params;
    const thread = getThread(db, id);
    if (!thread) {
      return reply.status(404).send({ error: "Thread not found" });
    }
    const limit = Math.min(500, Math.max(1, Number(request.query.limit) || 200));
    return { messages: listMessages(db, id, limit) };
  });
}
