import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  QA_CONFIG_KEY_PASSWORD,
  QA_CONFIG_KEY_USERNAME,
} from "../constants/systemConfigKeys.js";
import { getWikiCategoryLabel, WIKI_CATEGORIES, type WikiCategoryId } from "../constants/wikiCategory.js";
import { isWikiQaCodeRepoSlot, WIKI_CODE_REPO_SLOT_COUNT, wikiSourceTypeLabel } from "../constants/wikiSourceType.js";
import { getWikiDocSourceConfigByCategory, type WikiSourceRow } from "../db/wikiSource.js";
import { parseCodeRepoWikiUrl } from "../services/wiki/codeRepoWikiSource.js";
import { readAccessUserName } from "../services/accessLog.js";
import { prepareWikiQaDemoWorkspace } from "../services/file/prepareWikiQaDemoWorkspace.js";
import { contentDispositionAttachment } from "../services/file/contentDisposition.js";
import {
  listWikiQaAiOutputFiles,
  normalizeWikiQaUsername,
  readWikiQaCopiedSinceMs,
  resolveWikiQaAiOutputFile,
  saveWikiQaUploadToWorkspaceRoot,
  WIKI_QA_UPLOAD_MAX_BYTES,
} from "../services/file/wikiQaAiOutput.js";
import { readWikiQaPromptTemplate, isWikiQaPromptTemplateId } from "../services/file/readWikiQaPromptTemplate.js";
import {
  listWikiBaseCategories,
  listWikiBaseDir,
  readWikiBaseAsset,
  readWikiBaseFile,
} from "../services/file/wikiBaseFiles.js";
import { syncWikiCategoryFromConfluence } from "../services/wiki/wikiSyncService.js";
import { reloadWikiConfluencePage } from "../services/wiki/wikiConfluencePageReloadService.js";
import { syncWikiCategoryCodeRepos, syncWikiCategoryCodeRepoSlots, codeRepoSlotLabel } from "../services/wiki/codeRepoSyncService.js";
import { syncWikiCategoryQaTestCases } from "../services/wiki/qaTestCaseSyncService.js";
import { syncWikiCategoryQaTestMindMaps } from "../services/wiki/qaTestMindMapSyncService.js";
import { importTapdStoriesAsParentTasks } from "../services/wiki/tapdImportService.js";
import { resolveTapdWorkspaceId } from "../services/dbConfig.js";
import type { ConfluencePageTreeScope } from "../services/tools/confluenceClient.js";
import { zTaskCreator } from "../validation/taskCreatorZod.js";
import { loadConfig } from "../config.js";

const wikiCategoryIdValues = WIKI_CATEGORIES.map((c) => c.id) as [WikiCategoryId, ...WikiCategoryId[]];

const categoryIdParam = z.object({
  categoryId: z.enum(wikiCategoryIdValues),
});

const fileQuery = z.object({
  path: z.string().min(1).max(2048),
});

const confluenceReloadBody = z.object({
  path: z.string().min(1).max(2048),
  /** ocrspace=图片 OCR；multimodal=多模态转 Markdown */
  converter: z.enum(["ocrspace", "multimodal"]).optional().default("ocrspace"),
});

const filesListQuery = z.object({
  dir: z.string().max(2048).optional(),
});

const syncBody = z.object({
  scope: z.enum(["children", "descendants"]).optional(),
});

const prepareQaBody = z.object({
  include_confluence_docs: z.boolean().optional().default(false),
  include_automated_test_cases: z.boolean().optional().default(false),
  include_code_repo_slots: z
    .array(z.number().int().min(1).max(WIKI_CODE_REPO_SLOT_COUNT))
    .optional()
    .default([]),
  /** 勾选代码库时生效：先按此分支同步所选槽位到 code_base（默认 master） */
  branch_version: z.string().trim().min(1).max(500).optional(),
  creator: z.string().optional(),
});

const qaAiOutputFileQuery = z.object({
  path: z.string().min(1).max(2048),
});

const qaPromptTemplateIdParam = z.object({
  templateId: z.string().trim().min(1).max(120).refine(isWikiQaPromptTemplateId, {
    message: "invalid template id",
  }),
});

const tapdImportBody = z.object({
  /** TAPD 父故事/需求 parent_id（workspace_id 取自 system_config.tapd_workspace_id） */
  parent_id: z.string().trim().min(1).max(50),
  creator: zTaskCreator,
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

  app.get("/api/wiki-base/qa/config", async (_request, reply) => {
    const config = loadConfig();
    return reply.send({
      cursor_enabled: config.WIKI_QA_CURSOR_ENABLED,
      cursor_disabled_reason: config.WIKI_QA_CURSOR_ENABLED ? "" : config.WIKI_QA_CURSOR_DISABLED_REASON,
    });
  });

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

  /** 查询业务分类下的文档源配置（基线 / 迭代 / 系统优化 / 代码地址） */
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
        system_optimization_doc: config.system_optimization_doc
          ? serializeWikiSourceRow(config.system_optimization_doc)
          : null,
        automated_test_case: config.automated_test_case
          ? serializeWikiSourceRow(config.automated_test_case)
          : null,
        test_mind_map: config.test_mind_map ? serializeWikiSourceRow(config.test_mind_map) : null,
        code_repos: codeRepos,
        /** 兼容：代码库 1 */
        code_repo: codeRepos[0] ?? null,
      });
    } catch (err) {
      request.log.error(err, "list wiki_source doc config failed");
      return reply.status(500).send({ error: "list wiki_source doc config failed" });
    }
  });

  /** 立即同步：Confluence / QA 测试案例 → `wiki_base`，代码库 → `code_base` */
  app.post("/api/wiki-base/:categoryId/sync", async (request, reply) => {
    const parsedParams = categoryIdParam.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    const parsedBody = syncBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.message });
    }

    const categoryId = parsedParams.data.categoryId;
    const missingCredsMsg = `Confluence 未配置：请设置环境变量 CONFLUENCE_USERNAME / CONFLUENCE_PASSWORD（可选 CONFLUENCE_BASE_URL），或在全局 system_config 中配置相关键`;
    const missingQaCredsMsg = `QA 平台未配置：请在全局 system_config 中配置 ${JSON.stringify(QA_CONFIG_KEY_USERNAME)}、${JSON.stringify(QA_CONFIG_KEY_PASSWORD)}`;

    let confluence = null as Awaited<ReturnType<typeof syncWikiCategoryFromConfluence>> | null;
    let confluence_error: string | undefined;
    let qa_test_cases = null as Awaited<ReturnType<typeof syncWikiCategoryQaTestCases>> | null;
    let qa_test_cases_error: string | undefined;
    let qa_test_mind_maps = null as Awaited<ReturnType<typeof syncWikiCategoryQaTestMindMaps>> | null;
    let qa_test_mind_maps_error: string | undefined;

    try {
      confluence = await syncWikiCategoryFromConfluence(db, categoryId, {
        scope: parsedBody.data.scope as ConfluencePageTreeScope | undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "CONFLUENCE_CREDENTIALS_MISSING") {
        confluence_error = missingCredsMsg;
      } else {
        request.log.error(err, "wiki confluence sync failed");
        return reply.status(500).send({ error: `Wiki 文档同步失败: ${msg}` });
      }
    }

    try {
      qa_test_cases = await syncWikiCategoryQaTestCases(db, categoryId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "QA_CREDENTIALS_MISSING") {
        qa_test_cases_error = missingQaCredsMsg;
      } else {
        request.log.error(err, "wiki qa test case sync failed");
        return reply.status(500).send({ error: `自动化测试案例同步失败: ${msg}` });
      }
    }

    try {
      qa_test_mind_maps = await syncWikiCategoryQaTestMindMaps(db, categoryId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "QA_CREDENTIALS_MISSING") {
        qa_test_mind_maps_error = missingQaCredsMsg;
      } else {
        request.log.error(err, "wiki qa test mind map sync failed");
        return reply.status(500).send({ error: `测试脑图同步失败: ${msg}` });
      }
    }

    try {
      const code_repos = await syncWikiCategoryCodeRepos(db, categoryId);
      return reply.send({
        category_id: categoryId,
        confluence,
        confluence_error,
        qa_test_cases,
        qa_test_cases_error,
        qa_test_mind_maps,
        qa_test_mind_maps_error,
        code_repos,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error(err, "wiki code repo sync failed");
      return reply.status(500).send({ error: `代码库同步失败: ${msg}` });
    }
  });

  /** 智能问答前：按选项复制 Confluence 文档与 code_base 代码到 `task-repo/<username>/` */
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
      const usernameRaw = body.creator?.trim() || readAccessUserName(request.headers);
      let username: string;
      try {
        username = normalizeWikiQaUsername(usernameRaw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "获取当前登录用户失败";
        return reply.status(400).send({ error: msg });
      }
      const codeRepoSlots = [...new Set(body.include_code_repo_slots)]
        .filter(isWikiQaCodeRepoSlot)
        .sort((a, b) => a - b);
      let codeSyncResult: Awaited<ReturnType<typeof syncWikiCategoryCodeRepoSlots>> | null = null;
      let syncedBranch: string | undefined;

      // 传入 branch_version 时先按指定分支同步所选代码库（新 UI）；旧客户端不传则仍要求事先「立即同步」
      if (codeRepoSlots.length > 0 && body.branch_version !== undefined) {
        syncedBranch = body.branch_version.trim() || "master";
        codeSyncResult = await syncWikiCategoryCodeRepoSlots(db, categoryId, codeRepoSlots, {
          branchOverride: syncedBranch,
        });
        const failed: string[] = [];
        for (let i = 0; i < codeRepoSlots.length; i++) {
          const slot = codeRepoSlots[i];
          const item = codeSyncResult.sources[i];
          if (!item) continue;
          if (item.skipped) {
            failed.push(`${codeRepoSlotLabel(slot)}：${item.skip_reason || "跳过"}`);
          } else if (item.error) {
            failed.push(`${codeRepoSlotLabel(slot)}：${item.error}`);
          }
        }
        if (failed.length > 0) {
          return reply.status(400).send({ error: `代码库同步失败：${failed.join("；")}` });
        }
      }

      const result = prepareWikiQaDemoWorkspace(categoryId, {
        username,
        includeConfluenceDocs: body.include_confluence_docs,
        includeAutomatedTestCases: body.include_automated_test_cases,
        codeRepoSlots,
        db,
      });
      return reply.send({
        category_id: categoryId,
        copied: result.copied,
        test_case_copied: result.test_case_copied,
        code_copied: result.code_copied,
        code_slots: result.code_slots,
        demo_cwd: result.demo_cwd,
        copied_since_ms: result.copied_since_ms,
        branch_version: syncedBranch,
        code_sync: codeSyncResult,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "prepare wiki qa workspace failed";
      if (
        msg.includes("invalid") ||
        msg.includes("请至少") ||
        msg.includes("未配置") ||
        msg.includes("尚未同步") ||
        msg.includes("格式无效")
      ) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "prepare wiki qa workspace failed");
      return reply.status(500).send({ error: msg || "prepare wiki qa workspace failed" });
    }
  });

  /** 智能问答：上传文件到对话工作区根目录（`task-repo/<username>/`） */
  app.post("/api/wiki-base/qa/upload", async (request, reply) => {
    let username: string;
    try {
      username = normalizeWikiQaUsername(readAccessUserName(request.headers));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取当前登录用户失败";
      return reply.status(400).send({ error: msg });
    }
    if (readWikiQaCopiedSinceMs(username) == null) {
      return reply.status(400).send({ error: "请先完成智能问答工作区准备" });
    }
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: "Content-Type must be multipart/form-data" });
    }

    const saved: Array<{ name: string; size: number }> = [];
    try {
      const parts = request.files();
      for await (const part of parts) {
        if (part.file.truncated) {
          return reply.status(400).send({
            error: `file too large (max ${WIKI_QA_UPLOAD_MAX_BYTES} bytes)`,
          });
        }
        const buf = await part.toBuffer();
        const result = saveWikiQaUploadToWorkspaceRoot(username, part.filename || "upload.bin", buf);
        saved.push({ name: result.name, size: result.size });
      }
      if (saved.length === 0) {
        return reply.status(400).send({ error: "请选择要上传的文件（字段名 file）" });
      }
      return reply.send({
        uploaded: saved,
        count: saved.length,
        demo_cwd: `task-repo/${username}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "wiki qa upload failed";
      if (
        msg.includes("请先完成") ||
        msg.includes("invalid") ||
        msg.includes("too large") ||
        msg.includes("too long") ||
        msg.includes("filename")
      ) {
        return reply.status(400).send({ error: msg });
      }
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(400).send({ error: `file too large (max ${WIKI_QA_UPLOAD_MAX_BYTES} bytes)` });
      }
      request.log.error(err, "wiki qa upload failed");
      return reply.status(500).send({ error: msg || "wiki qa upload failed" });
    }
  });

  /** 智能问答：读取快捷提示词模板 Markdown */
  app.get("/api/wiki-base/qa/prompt-templates/:templateId", async (request, reply) => {
    const parsed = qaPromptTemplateIdParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid template id" });
    }
    const prompt = readWikiQaPromptTemplate(parsed.data.templateId);
    if (prompt == null) {
      return reply.status(404).send({ error: "prompt template not found" });
    }
    return reply.send({ id: parsed.data.templateId, prompt });
  });

  /** 智能问答：列出复制完成后 AI 新增/修改的文件 */
  app.get("/api/wiki-base/qa/ai-output", async (request, reply) => {
    let username: string;
    try {
      username = normalizeWikiQaUsername(readAccessUserName(request.headers));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取当前登录用户失败";
      return reply.status(400).send({ error: msg });
    }
    const copiedSinceMs = readWikiQaCopiedSinceMs(username);
    if (copiedSinceMs == null) {
      return reply.status(400).send({ error: "请先完成智能问答工作区准备" });
    }
    const files = listWikiQaAiOutputFiles(copiedSinceMs, username);
    return reply.send({
      copied_since_ms: copiedSinceMs,
      files,
      count: files.length,
    });
  });

  /** 智能问答：下载单个 AI 输出文件 */
  app.get("/api/wiki-base/qa/ai-output/file", async (request, reply) => {
    let username: string;
    try {
      username = normalizeWikiQaUsername(readAccessUserName(request.headers));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取当前登录用户失败";
      return reply.status(400).send({ error: msg });
    }
    const copiedSinceMs = readWikiQaCopiedSinceMs(username);
    if (copiedSinceMs == null) {
      return reply.status(400).send({ error: "请先完成智能问答工作区准备" });
    }
    const parsedQuery = qaAiOutputFileQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: "path query is required" });
    }
    try {
      const file = resolveWikiQaAiOutputFile(copiedSinceMs, username, parsedQuery.data.path);
      if (!file) {
        return reply.status(404).send({ error: "file not found" });
      }
      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", String(file.size))
        .header("Content-Disposition", contentDispositionAttachment(file.name))
        .send(createReadStream(file.absolute_path));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "read wiki qa ai output file failed";
      if (msg.includes("invalid") || msg.includes("outside")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "wiki qa ai output file download failed");
      return reply.status(500).send({ error: "read wiki qa ai output file failed" });
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

  /** Wiki 文档内嵌图片（`_assets/` 等相对路径） */
  app.get("/api/wiki-base/:categoryId/asset", async (request, reply) => {
    const parsedParams = categoryIdParam.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    const parsedQuery = fileQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: "path query is required" });
    }
    try {
      const asset = readWikiBaseAsset(parsedParams.data.categoryId, parsedQuery.data.path);
      if (!asset) {
        return reply.status(404).send({ error: "asset not found" });
      }
      return reply.header("Content-Type", asset.mime).header("Cache-Control", "private, max-age=3600").send(asset.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "read wiki_base asset failed";
      if (msg.includes("invalid")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "read wiki_base asset failed");
      return reply.status(500).send({ error: "read wiki_base asset failed" });
    }
  });

  /** 单页从 Confluence 重新拉取图片附件并 OCR / 多模态识别，识别后写回磁盘 .md 并返回展示内容 */
  app.post("/api/wiki-base/:categoryId/confluence-reload", async (request, reply) => {
    const parsedParams = categoryIdParam.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    const parsedBody = confluenceReloadBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }
    try {
      const result = await reloadWikiConfluencePage(
        db,
        parsedParams.data.categoryId,
        parsedBody.data.path.trim(),
        parsedBody.data.converter,
      );
      return reply.send({
        doc: result.doc,
        display_markdown: result.display_markdown,
        images_downloaded: result.images_downloaded,
        images_failed: result.images_failed,
        images_ocr_recognized: result.images_ocr_recognized,
        images_multimodal_recognized: result.images_multimodal_recognized,
        warnings: result.warnings,
        converter: result.converter,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "CONFLUENCE_CREDENTIALS_MISSING") {
        return reply.status(503).send({
          error: "Confluence 未配置：请设置 CONFLUENCE_USERNAME / CONFLUENCE_PASSWORD（可选 CONFLUENCE_BASE_URL）",
        });
      }
      if (msg === "OCR_SPACE_API_KEY_MISSING") {
        return reply.status(503).send({
          error: "OCR.space API Key 未配置：请设置环境变量 OCR_SPACE_API_KEY（免费 key 可在 https://ocr.space/ocrapi 注册）",
        });
      }
      if (msg === "MULTIMODAL_API_KEY_MISSING") {
        return reply.status(503).send({
          error:
            "多模态 API Key 未配置：请设置环境变量 MULTIMODAL_API_KEY，或在全局 system_config 中配置 multimodal_api_key",
        });
      }
      if (msg === "file not found") {
        return reply.status(404).send({ error: msg });
      }
      if (msg.includes("无法识别 Confluence pageId") || msg.includes("invalid")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "wiki confluence page reload failed");
      return reply.status(500).send({ error: msg });
    }
  });

  /** 从 TAPD 拉取 parent_id 下故事并创建业务 Agent 父任务 */
  app.post("/api/wiki-base/:categoryId/tapd-import", async (request, reply) => {
    const parsedParams = categoryIdParam.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: "invalid category id" });
    }
    const parsedBody = tapdImportBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }
    try {
      const workspaceId = resolveTapdWorkspaceId(db, parsedBody.data.creator);
      if (!workspaceId) {
        return reply.status(400).send({
          error: "未配置 TAPD workspace_id，请在 system_config 中设置 tapd_workspace_id",
        });
      }
      const result = await importTapdStoriesAsParentTasks(db, {
        categoryId: parsedParams.data.categoryId,
        workspaceId,
        parentId: parsedBody.data.parent_id,
        creator: parsedBody.data.creator,
      });
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("未配置 TAPD Token") ||
        msg.includes("未配置 TAPD workspace_id") ||
        msg.includes("creator is required") ||
        msg.includes("workspace_id") ||
        msg.includes("TAPD Token")
      ) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "tapd import failed");
      return reply.status(500).send({ error: msg });
    }
  });
}
