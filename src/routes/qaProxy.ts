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
}
