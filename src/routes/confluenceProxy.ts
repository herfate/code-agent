import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  CONFLUENCE_CONFIG_KEY_BASE_URL,
  CONFLUENCE_CONFIG_KEY_PASSWORD,
  CONFLUENCE_CONFIG_KEY_USERNAME,
} from "../constants/systemConfigKeys.js";
import { contentDispositionAttachment } from "../services/file/contentDisposition.js";
import {
  confluenceZipDownloadName,
  zipConfluenceTreeDir,
} from "../services/file/zipConfluenceExport.js";
import {
  saveConfluencePageExport,
  saveConfluencePagePdfExport,
  writeConfluenceExportErrorsFile,
} from "../services/file/writeConfluenceMarkdown.js";
import {
  exportConfluencePageTreeMarkdown,
  exportConfluencePageTreePdf,
  resolveConfluenceCredentials,
  type ConfluenceCredentials,
  type ConfluencePageTreeScope,
  type ExportConfluencePageTreeOptions,
} from "../services/tools/confluenceClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const exportHtmlPath = join(__dirname, "..", "..", "public", "confluenceExport.html");

function err(code: number, message: string, extra?: Record<string, unknown>) {
  return { code, message, ...extra };
}

const pageTreeBody = z
  .object({
    url: z.string().min(1).max(4096).optional(),
    pageId: z.string().regex(/^\d+$/).optional(),
    scope: z.enum(["children", "descendants"]).optional().default("descendants"),
  })
  .refine((v) => Boolean(v.url?.trim() || v.pageId), {
    message: "请提供 url 或 pageId",
  });

const pageTreeQuery = pageTreeBody;

async function runPageTreeExport(
  creds: ConfluenceCredentials,
  options: ExportConfluencePageTreeOptions,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const result = await exportConfluencePageTreeMarkdown(creds, options, saveConfluencePageExport);

  if (result.saved === 0) {
    return reply.status(500).send(
      err(500, "没有成功导出的页面", {
        total: result.total,
        errors: result.errors,
      }),
    );
  }

  writeConfluenceExportErrorsFile(result.output_dir, result.errors);
  const downloadName = confluenceZipDownloadName(result.rootPageId, result.rootTitle);
  const { zipPath } = await zipConfluenceTreeDir(result.output_dir);
  const { size } = statSync(zipPath);

  return reply
    .header("Content-Type", "application/zip")
    .header("Content-Length", size)
    .header("Content-Disposition", contentDispositionAttachment(downloadName))
    .send(createReadStream(zipPath));
}

async function runPageTreePdfExport(
  creds: ConfluenceCredentials,
  options: ExportConfluencePageTreeOptions,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const result = await exportConfluencePageTreePdf(creds, options, saveConfluencePagePdfExport);

  if (result.saved === 0) {
    return reply.status(500).send(
      err(500, "没有成功导出的 PDF 页面", {
        total: result.total,
        errors: result.errors,
      }),
    );
  }

  writeConfluenceExportErrorsFile(result.output_dir, result.errors);
  const downloadName = confluenceZipDownloadName(result.rootPageId, result.rootTitle, "pdf");
  const { zipPath } = await zipConfluenceTreeDir(result.output_dir);
  const { size } = statSync(zipPath);

  return reply
    .header("Content-Type", "application/zip")
    .header("Content-Length", size)
    .header("Content-Disposition", contentDispositionAttachment(downloadName))
    .send(createReadStream(zipPath));
}

/** Confluence Server：根页面 + 子孙批量导出 txt 并打包 zip 下载 */
export function registerConfluenceProxyRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  const missingCredsMsg = () =>
    `Confluence 未配置：请设置环境变量 CONFLUENCE_USERNAME / CONFLUENCE_PASSWORD（可选 CONFLUENCE_BASE_URL），或在全局 system_config 中配置 ${JSON.stringify(CONFLUENCE_CONFIG_KEY_USERNAME)}、${JSON.stringify(CONFLUENCE_CONFIG_KEY_PASSWORD)}（仅 pageId 查询时还需 ${JSON.stringify(CONFLUENCE_CONFIG_KEY_BASE_URL)}）`;

  app.get("/confluence/export", async (_request, reply) => {
    const html = await readFile(exportHtmlPath, "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  const handleExport = async (
    request: { query: unknown; body: unknown; log: { error: (obj: object, msg: string) => void } },
    reply: FastifyReply,
    input: ExportConfluencePageTreeOptions,
  ) => {
    const creds = resolveConfluenceCredentials(db);
    if (!creds) {
      return reply.status(503).send(err(503, missingCredsMsg()));
    }

    try {
      return await runPageTreeExport(creds, input, reply);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.error({ err: e }, "confluence page-tree-to-markdown");
      return reply.status(500).send(err(500, `Confluence 批量导出失败: ${msg}`));
    }
  };

  /** GET：url 须 encodeURIComponent；推荐用 POST 或 /confluence/export 页面 */
  app.get("/confluence/page-tree-to-markdown", async (request, reply) => {
    const parsed = pageTreeQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(err(400, parsed.error.message));
    }
    return handleExport(request, reply, {
      url: parsed.data.url?.trim(),
      pageId: parsed.data.pageId,
      scope: parsed.data.scope as ConfluencePageTreeScope,
    });
  });

  /** POST JSON：{ url?, pageId?, scope? }，适合浏览器与长 URL */
  app.post("/confluence/page-tree-to-markdown", async (request, reply) => {
    const parsed = pageTreeBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(400, parsed.error.message));
    }
    return handleExport(request, reply, {
      url: parsed.data.url?.trim(),
      pageId: parsed.data.pageId,
      scope: parsed.data.scope as ConfluencePageTreeScope,
    });
  });

  const handlePageTreePdfExport = async (
    request: { query: unknown; body: unknown; log: { error: (obj: object, msg: string) => void } },
    reply: FastifyReply,
    input: ExportConfluencePageTreeOptions,
  ) => {
    const creds = resolveConfluenceCredentials(db);
    if (!creds) {
      return reply.status(503).send(err(503, missingCredsMsg()));
    }

    try {
      return await runPageTreePdfExport(creds, input, reply);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.error({ err: e }, "confluence page-tree-to-pdf");
      return reply.status(500).send(err(500, `Confluence PDF 批量导出失败: ${msg}`));
    }
  };

  /** GET：根页面 + 子孙 FlyingPDF 批量导出 zip */
  app.get("/confluence/page-tree-to-pdf", async (request, reply) => {
    const parsed = pageTreeQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(err(400, parsed.error.message));
    }
    return handlePageTreePdfExport(request, reply, {
      url: parsed.data.url?.trim(),
      pageId: parsed.data.pageId,
      scope: parsed.data.scope as ConfluencePageTreeScope,
    });
  });

  /** POST JSON：{ url?, pageId?, scope? }，根页面 + 子孙 PDF zip */
  app.post("/confluence/page-tree-to-pdf", async (request, reply) => {
    const parsed = pageTreeBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(400, parsed.error.message));
    }
    return handlePageTreePdfExport(request, reply, {
      url: parsed.data.url?.trim(),
      pageId: parsed.data.pageId,
      scope: parsed.data.scope as ConfluencePageTreeScope,
    });
  });
}
