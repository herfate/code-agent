import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { getThread, listMessages, listThreads, listThreadsFiltered, createThread } from "../db/repository.js";

const createThreadBody = z.object({
  title: z.string().max(500).optional(),
  provider: z.enum(["claude", "codex"]),
});

const listThreadsQuery = z.object({
  provider: z.enum(["claude", "codex"]).optional(),
  title: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export function registerThreadRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/threads", async (request, reply) => {
    const parsed = listThreadsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const q = parsed.data;
    const hasFilter = q.provider !== undefined || (q.title !== undefined && q.title.trim() !== "");
    if (hasFilter) {
      return {
        threads: listThreadsFiltered(db, {
          provider: q.provider,
          titleContains: q.title?.trim() || undefined,
          limit: q.limit,
        }),
      };
    }
    return { threads: listThreads(db, q.limit ?? 100) };
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
