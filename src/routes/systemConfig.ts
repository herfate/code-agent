import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ANTHROPIC_CONFIG_KEY_API_KEY, GITLAB_CONFIG_KEY_TOKEN } from "../constants/systemConfigKeys.js";
import {
  deleteSystemConfig,
  getUserConfigByKey,
  listSystemConfigsFiltered,
  upsertUserConfig,
} from "../db/systemConfig.js";
import { parseConfigStringValue } from "../services/dbConfig.js";
import { zTaskCreator } from "../validation/taskCreatorZod.js";

const listQuery = z.object({
  scope: z.enum(["global", "user"]).optional(),
  username: z.string().max(256).optional(),
  config_key: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const gitlabTokenQuery = z.object({
  username: zTaskCreator,
});

const gitlabTokenBody = z.object({
  username: zTaskCreator,
  /** 留空则清除该用户的 token 配置 */
  gitlab_token: z.string().max(500).optional().default(""),
});

const anthropicApiKeyBody = z.object({
  username: zTaskCreator,
  /** 留空则清除该用户的 Claude Auth Token 配置 */
  anthropic_api_key: z.string().max(500).optional().default(""),
});

/** 脱敏展示 token，完整值勿下发给浏览器 */
function maskSecretToken(token: string): string {
  const t = token.trim();
  if (!t) return "";
  if (t.length <= 8) return "****";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function readUserSecretConfigStatus(
  db: DatabaseSync,
  username: string,
  configKey: string,
): { username: string; configured: boolean; token_masked?: string; updated_at?: number } {
  const row = getUserConfigByKey(db, username, configKey);
  if (!row) {
    return { username, configured: false };
  }
  const token = parseConfigStringValue(row.value_json);
  return {
    username,
    configured: Boolean(token.trim()),
    token_masked: token.trim() ? maskSecretToken(token) : undefined,
    updated_at: row.updated_at,
  };
}

function saveUserSecretConfig(
  db: DatabaseSync,
  username: string,
  configKey: string,
  tokenRaw: string,
  description: string,
): { username: string; configured: boolean; token_masked?: string; updated_at?: number } {
  const token = tokenRaw.trim();
  if (!token) {
    const existing = getUserConfigByKey(db, username, configKey);
    if (existing) {
      deleteSystemConfig(db, existing.id);
    }
    return { username, configured: false };
  }
  const row = upsertUserConfig(db, {
    username,
    config_key: configKey,
    value_json: JSON.stringify(token),
    description,
  });
  return {
    username,
    configured: true,
    token_masked: maskSecretToken(token),
    updated_at: row.updated_at,
  };
}

export function registerSystemConfigRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/user-config/gitlab-token", async (request, reply) => {
    const parsed = gitlabTokenQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return readUserSecretConfigStatus(db, parsed.data.username, GITLAB_CONFIG_KEY_TOKEN);
  });

  app.put("/api/user-config/gitlab-token", async (request, reply) => {
    const parsed = gitlabTokenBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { username, gitlab_token: tokenRaw } = parsed.data;
    return saveUserSecretConfig(
      db,
      username,
      GITLAB_CONFIG_KEY_TOKEN,
      tokenRaw,
      "GitLab Personal Access Token（用户级）",
    );
  });

  app.get("/api/user-config/anthropic-api-key", async (request, reply) => {
    const parsed = gitlabTokenQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return readUserSecretConfigStatus(db, parsed.data.username, ANTHROPIC_CONFIG_KEY_API_KEY);
  });

  app.put("/api/user-config/anthropic-api-key", async (request, reply) => {
    const parsed = anthropicApiKeyBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { username, anthropic_api_key: tokenRaw } = parsed.data;
    return saveUserSecretConfig(
      db,
      username,
      ANTHROPIC_CONFIG_KEY_API_KEY,
      tokenRaw,
      "Claude Auth Token（用户级，写入 ~/.claude.json env.ANTHROPIC_AUTH_TOKEN）",
    );
  });

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
