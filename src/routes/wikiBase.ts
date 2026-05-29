import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  CONFLUENCE_CONFIG_KEY_BASE_URL,
  CONFLUENCE_CONFIG_KEY_PASSWORD,
  CONFLUENCE_CONFIG_KEY_USERNAME,
} from "../constants/systemConfigKeys.js";
import { getWikiCategoryLabel } from "../constants/wikiCategory.js";
import { isWikiQaCodeRepoSlot, WIKI_CODE_REPO_SLOT_COUNT, wikiSourceTypeLabel } from "../constants/wikiSourceType.js";
import { getWikiDocSourceConfigByCategory, type WikiSourceRow } from "../db/wikiSource.js";
import { parseCodeRepoWikiUrl } from "../services/wiki/codeRepoWikiSource.js";
import { prepareWikiQaDemoWorkspace } from "../services/file/prepareWikiQaDemoWorkspace.js";
import {
  listWikiBaseCategories,
  listWikiBaseDir,
  readWikiBaseFile,
} from "../services/file/wikiBaseFiles.js";
import { syncWikiCategoryFromConfluence } from "../services/wiki/wikiSyncService.js";
import type { ConfluencePageTreeScope } from "../services/tools/confluenceClient.js";

const categoryIdParam = z.object({
  categoryId: z.enum(["1", "2", "3", "4"]),
});

const fileQuery = z.object({
  path: z.string().min(1).max(2048),
});

const filesListQuery = z.object({
  dir: z.string().max(2048).optional(),
});

const syncBody = z.object({
  scope: z.enum(["children", "descendants"]).optional(),
});

const prepareQaBody = z.object({
  include_confluence_docs: z.boolean().optional().default(false),
  include_code_repo_slots: z
    .array(z.number().int().min(1).max(WIKI_CODE_REPO_SLOT_COUNT))
    .optional()
    .default([]),
  creator: z.string().optional(),
});

function serializeWikiSourceRow(row: WikiSourceRow) {
  return {
    ...row,
    source_type_label: wikiSourceTypeLabel(row.source_type),
  };
}

function serializeCodeRepoRow(row: WikiSourceRow | null) {
  if (!row) return null;
  const pair = parseCodeRepoWikiUrl(row.wiki_url);
  return {
    ...serializeWikiSourceRow(row),
    gitRemoteUrl: pair?.gitRemoteUrl ?? "",
    branch_version: pair?.branch_version ?? "master",
  };
}

/** Wiki 知识库：`wiki_base/<categoryId>/` 文件列表与预览；`wiki_source` 文档源配置 */
export function registerWikiBaseRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;
  app.get("/api/wiki-base/categories", async (_request, reply) => {
    return reply.send({ categories: listWikiBaseCategories() });
  });

  app.get("/api/wiki-base/:categoryId/files", async (request, reply) => {
    const parsedParams = categoryIdParam.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    const parsedQuery = filesListQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.message });
    }
    try {
      const listing = listWikiBaseDir(parsedParams.data.categoryId, parsedQuery.data.dir ?? "");
      return reply.send(listing);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "list wiki_base files failed";
      if (msg.includes("invalid")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "list wiki_base files failed");
      return reply.status(500).send({ error: "list wiki_base files failed" });
    }
  });

  /** 查询业务分类下的文档源配置（基线 / 迭代 / 代码地址） */
  app.get("/api/wiki-base/:categoryId/sources", async (request, reply) => {
    const parsed = categoryIdParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    try {
      const categoryId = parsed.data.categoryId;
      const config = getWikiDocSourceConfigByCategory(db, categoryId);
      const codeRepos = config.code_repos.map(serializeCodeRepoRow);
      return reply.send({
        category_id: categoryId,
        category_label: getWikiCategoryLabel(categoryId) ?? categoryId,
        baseline_doc: config.baseline_doc ? serializeWikiSourceRow(config.baseline_doc) : null,
        requirement_iteration_doc: config.requirement_iteration_doc
          ? serializeWikiSourceRow(config.requirement_iteration_doc)
          : null,
        code_repos: codeRepos,
        /** 兼容：代码库 1 */
        code_repo: codeRepos[0] ?? null,
      });
    } catch (err) {
      request.log.error(err, "list wiki_source doc config failed");
      return reply.status(500).send({ error: "list wiki_source doc config failed" });
    }
  });

  /** 立即同步：按 `wiki_source` 配置从 Confluence 拉取到 `wiki_base/<categoryId>/<sourceType>/` */
  app.post("/api/wiki-base/:categoryId/sync", async (request, reply) => {
    const parsedParams = categoryIdParam.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    const parsedBody = syncBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.message });
    }

    const missingCredsMsg = `Confluence 未配置：请设置环境变量 CONFLUENCE_USERNAME / CONFLUENCE_PASSWORD（可选 CONFLUENCE_BASE_URL），或在全局 system_config 中配置 ${JSON.stringify(CONFLUENCE_CONFIG_KEY_USERNAME)}、${JSON.stringify(CONFLUENCE_CONFIG_KEY_PASSWORD)}（仅 pageId 查询时还需 ${JSON.stringify(CONFLUENCE_CONFIG_KEY_BASE_URL)}）`;

    try {
      const result = await syncWikiCategoryFromConfluence(
        db,
        parsedParams.data.categoryId,
        { scope: parsedBody.data.scope as ConfluencePageTreeScope | undefined },
      );
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "CONFLUENCE_CREDENTIALS_MISSING") {
        return reply.status(503).send({ error: missingCredsMsg });
      }
      request.log.error(err, "wiki confluence sync failed");
      return reply.status(500).send({ error: `Wiki 同步失败: ${msg}` });
    }
  });

  /** 智能问答前：按选项复制 Confluence 文档和/或克隆代码库到 `task-repo/demo/` */
  app.post("/api/wiki-base/:categoryId/prepare-qa", async (request, reply) => {
    const parsedParams = categoryIdParam.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    const parsedBody = prepareQaBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.message });
    }
    try {
      const categoryId = parsedParams.data.categoryId;
      const body = parsedBody.data;
      const result = prepareWikiQaDemoWorkspace(categoryId, {
        includeConfluenceDocs: body.include_confluence_docs,
        codeRepoSlots: [...new Set(body.include_code_repo_slots)].filter(isWikiQaCodeRepoSlot),
        db,
        creator: body.creator?.trim() || null,
        log: request.log,
      });
      return reply.send({
        category_id: categoryId,
        copied: result.copied,
        clone_started: result.clone_started,
        clone_slots: result.clone_slots,
        demo_cwd: result.demo_cwd,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "prepare wiki qa workspace failed";
      if (
        msg.includes("invalid") ||
        msg.includes("请至少") ||
        msg.includes("未配置")
      ) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "prepare wiki qa workspace failed");
      return reply.status(500).send({ error: msg || "prepare wiki qa workspace failed" });
    }
  });

  app.get("/api/wiki-base/:categoryId/file", async (request, reply) => {
    const parsedParams = categoryIdParam.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    const parsedQuery = fileQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: "path query is required" });
    }
    try {
      const doc = readWikiBaseFile(parsedParams.data.categoryId, parsedQuery.data.path);
      if (!doc) {
        return reply.status(404).send({ error: "file not found" });
      }
      return reply.send(doc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "read wiki_base file failed";
      if (msg.includes("invalid")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "read wiki_base file failed");
      return reply.status(500).send({ error: "read wiki_base file failed" });
    }
  });
}
