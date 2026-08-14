import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  QA_CONFIG_KEY_PASSWORD,
  QA_CONFIG_KEY_USERNAME,
} from "../constants/systemConfigKeys.js";
import { getQaCredentials } from "../services/dbConfig.js";
import { qaGetData, qaPostRaw } from "../services/tools/qaPlatformClient.js";

function ok<T>(data: T) {
  return { code: 200 as const, message: "success", data };
}

function err(code: number, message: string) {
  return { code, message };
}

const appNameQuery = z.object({
  appName: z.string().min(1).max(512),
});

const scriptListBody = z.record(z.string(), z.unknown());

const labelFindPageBody = z.object({
  pageNum: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(9999).optional().default(9999),
  data: z
    .object({
      title: z.string().trim().max(500).optional(),
    })
    .optional()
    .default({}),
});

/** 解析 QA 平台 POST 响应中的分页 `list` */
function parseQaLabelFindPageList(raw: string): { list: unknown[]; total?: number } {
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return { list: [] };
  }
  if (typeof json !== "object" || json === null) return { list: [] };
  const data = (json as { data?: unknown }).data;
  if (Array.isArray(data)) return { list: data };
  if (typeof data === "object" && data !== null && Array.isArray((data as { list?: unknown[] }).list)) {
    const page = data as { list: unknown[]; total?: unknown };
    const total = typeof page.total === "number" ? page.total : undefined;
    return { list: page.list, total };
  }
  return { list: [] };
}

/**
 * 对齐原 Spring `QATestController`（`/qa`）：转发 Howbuy QA 平台；
 * 站点固定为 `http://qa.howbuy.pa`，账号密码来自全局 `system_config`（见 `QA_CONFIG_KEY_*`）。
 */
export function registerQaProxyRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  const missingCredsMsg = () =>
    `QA 平台未配置：请在全局 system_config 中设置 config_key 为 ${JSON.stringify(QA_CONFIG_KEY_USERNAME)}、${JSON.stringify(QA_CONFIG_KEY_PASSWORD)} 的两条记录（value_json 为 JSON 字符串或裸文本）`;

  app.get("/qa/findAllAppInfo", async (request, reply) => {
    const creds = getQaCredentials(db);
    if (!creds) {
      return reply.status(503).send(err(503, missingCredsMsg()));
    }
    try {
      const data = await qaGetData(creds, "/qa-info/spider/findAllAppInfo");
      return ok(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.error({ err: e }, "qa findAllAppInfo");
      return reply.status(500).send(err(500, `查询失败: ${msg}`));
    }
  });

  app.get("/qa/getVersionAndArchiveStatusListByApp", async (request, reply) => {
    const creds = getQaCredentials(db);
    if (!creds) {
      return reply.status(503).send(err(503, missingCredsMsg()));
    }
    const parsed = appNameQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(err(400, parsed.error.message));
    }
    const q = `/qa-info/testAppVersion/getVersionAndArchiveStatusListByApp?appName=${encodeURIComponent(parsed.data.appName)}`;
    try {
      const data = await qaGetData(creds, q);
      return ok(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.error({ err: e }, "qa getVersionAndArchiveStatusListByApp");
      return reply.status(500).send(err(500, `查询失败: ${msg}`));
    }
  });

  app.post("/qa/getScriptList", async (request, reply) => {
    console.log('-----------------')
    const creds = getQaCredentials(db);
    if (!creds) {
      return reply.status(503).send(err(503, missingCredsMsg()));
    }
    const parsed = scriptListBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(400, "请求体须为 JSON 对象"));
    }
    try {
      const raw = await qaPostRaw(creds, "/qa-info/getScriptList", JSON.stringify(parsed.data));
      console.log(raw)
      let data: unknown = raw;
      try {
        data = JSON.parse(raw) as unknown;
      } catch {
        /* 与 Java 一致：非 JSON 时原样放在 data */
      }
      return ok(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.error({ err: e }, "qa getScriptList");
      return reply.status(500).send(err(500, `查询失败: ${msg}`));
    }
  });

  app.post("/qa/label/findPage", async (request, reply) => {
    const creds = getQaCredentials(db);
    if (!creds) {
      return reply.status(503).send(err(503, missingCredsMsg()));
    }
    const parsed = labelFindPageBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send(err(400, parsed.error.message));
    }
    try {
      const raw = await qaPostRaw(
        creds,
        "/qa-info/label/findPage",
        JSON.stringify(parsed.data),
      );
      const { list, total } = parseQaLabelFindPageList(raw);
      return ok({ list, total, pageNum: parsed.data.pageNum, pageSize: parsed.data.pageSize });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.error({ err: e }, "qa label findPage");
      return reply.status(500).send(err(500, `查询失败: ${msg}`));
    }
  });
}
