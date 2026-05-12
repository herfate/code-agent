import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";

export function registerHealthRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  app.get("/health", async (_request, reply) => {
    try {
      deps.db.prepare("SELECT 1 AS ok").get();
      return { ok: true, db: true };
    } catch (err) {
      reply.status(503);
      return { ok: false, db: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
