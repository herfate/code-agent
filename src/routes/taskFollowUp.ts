import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { appendTaskFollowUp } from "../services/task/appendTaskFollowUp.js";

const followUpBody = z.object({
  message: z.string().trim().min(1).max(50_000),
});

export function registerTaskFollowUpRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.post("/api/tasks/:taskId/follow-up", async (request, reply) => {
    const taskIdParsed = z.string().uuid().safeParse((request.params as { taskId?: string }).taskId);
    if (!taskIdParsed.success) {
      return reply.status(400).send({ error: "invalid taskId" });
    }
    const parsed = followUpBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const result = appendTaskFollowUp(db, taskIdParsed.data, parsed.data.message);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return reply.status(200).send({ task: result.task });
  });
}
