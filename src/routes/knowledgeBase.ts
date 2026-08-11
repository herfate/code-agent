import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { KNOWLEDGE_BASE_CATEGORY } from "../services/file/promoteToKnowledgeBase.js";
import {
  listKnowledgeBaseRepos,
  readKnowledgeBaseFile,
} from "../services/file/knowledgeBaseFiles.js";

const categoryEnum = z.enum([
  KNOWLEDGE_BASE_CATEGORY.CodeStyle,
  KNOWLEDGE_BASE_CATEGORY.BusinessCore,
]);

const fileQuery = z.object({
  category: categoryEnum,
  project: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(2048),
});

/** knowledge_base 只读浏览：按 git 仓库聚合 code-style / business-core */
export function registerKnowledgeBaseRoutes(app: FastifyInstance): void {
  app.get("/api/knowledge-base/repos", async (_request, reply) => {
    try {
      const repos = listKnowledgeBaseRepos();
      return reply.send({ repos });
    } catch (err) {
      _request.log.error(err, "list knowledge_base repos failed");
      return reply.status(500).send({ error: "list knowledge_base repos failed" });
    }
  });

  app.get("/api/knowledge-base/file", async (request, reply) => {
    const parsed = fileQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    try {
      const doc = readKnowledgeBaseFile({
        category: parsed.data.category,
        project: parsed.data.project,
        path: parsed.data.path,
      });
      return reply.send(doc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "read knowledge_base file failed";
      if (
        msg.includes("invalid") ||
        msg.includes("unsupported") ||
        msg.includes("outside")
      ) {
        return reply.status(400).send({ error: msg });
      }
      if (msg.includes("not found")) {
        return reply.status(404).send({ error: msg });
      }
      request.log.error(err, "read knowledge_base file failed");
      return reply.status(500).send({ error: "read knowledge_base file failed" });
    }
  });
}
