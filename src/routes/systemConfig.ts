import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { listSystemConfigsFiltered } from "../db/systemConfig.js";

const listQuery = z.object({
  scope: z.enum(["global", "user"]).optional(),
  username: z.string().max(256).optional(),
  config_key: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export function registerSystemConfigRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/system-config", async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const q = parsed.data;
    const rows = listSystemConfigsFiltered(db, {
      scope: q.scope,
      username: q.username,
      configKeyContains: q.config_key,
      limit: q.limit,
    });
    return { configs: rows };
  });
}
