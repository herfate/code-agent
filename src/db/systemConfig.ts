import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export type ConfigScope = "global" | "user";

/** 系统配置（全局或按用户覆盖，与表 `system_config` 对应） */
export type SystemConfigRow = {
  id: string;
  scope: ConfigScope;
  /** `scope === 'user'` 时为用户名；全局配置为 `null` */
  username: string | null;
  config_key: string;
  /** JSON 字符串 */
  value_json: string;
  description: string;
  created_at: number;
  updated_at: number;
};

export type CreateSystemConfigInput = {
  id: string;
  scope: ConfigScope;
  username?: string | null;
  config_key: string;
  value_json: string;
  description?: string;
};

export type UpdateSystemConfigPatch = Partial<{
  config_key: string;
  value_json: string;
  description: string;
}>;

function now(): number {
  return Date.now();
}

function normalizeUserInput(scope: ConfigScope, username: string | null | undefined): string | null {
  if (scope === "global") return null;
  const u = username?.trim();
  if (!u) throw new Error("scope=user requires non-empty username");
  return u;
}

export function createSystemConfig(db: DatabaseSync, input: CreateSystemConfigInput): SystemConfigRow {
  const t = now();
  const username = normalizeUserInput(input.scope, input.username);
  const description = input.description ?? "";
  db.prepare(
    `INSERT INTO system_config (id, scope, username, config_key, value_json, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.scope,
    username,
    input.config_key,
    input.value_json,
    description,
    t,
    t,
  );
  return getSystemConfig(db, input.id)!;
}

export function getSystemConfig(db: DatabaseSync, id: string): SystemConfigRow | undefined {
  return db
    .prepare(
      `SELECT id, scope, username, config_key, value_json, description, created_at, updated_at
       FROM system_config WHERE id = ?`,
    )
    .get(id) as SystemConfigRow | undefined;
}

export function getGlobalConfigByKey(db: DatabaseSync, configKey: string): SystemConfigRow | undefined {
  return db
    .prepare(
      `SELECT id, scope, username, config_key, value_json, description, created_at, updated_at
       FROM system_config WHERE scope = 'global' AND username IS NULL AND config_key = ?`,
    )
    .get(configKey) as SystemConfigRow | undefined;
}

export function getUserConfigByKey(db: DatabaseSync, username: string, configKey: string): SystemConfigRow | undefined {
  const u = username.trim();
  if (!u) return undefined;
  return db
    .prepare(
      `SELECT id, scope, username, config_key, value_json, description, created_at, updated_at
       FROM system_config WHERE scope = 'user' AND username = ? AND config_key = ?`,
    )
    .get(u, configKey) as SystemConfigRow | undefined;
}

/** 先查用户级，若无则查全局（`username` 为空则仅全局） */
export function resolveConfigByKey(
  db: DatabaseSync,
  username: string | null | undefined,
  configKey: string,
): { row: SystemConfigRow; source: ConfigScope } | undefined {
  const u = username?.trim();
  if (u) {
    const userRow = getUserConfigByKey(db, u, configKey);
    if (userRow) return { row: userRow, source: "user" };
  }
  const globalRow = getGlobalConfigByKey(db, configKey);
  if (globalRow) return { row: globalRow, source: "global" };
  return undefined;
}

export function listGlobalConfigs(db: DatabaseSync, limit = 500): SystemConfigRow[] {
  return db
    .prepare(
      `SELECT id, scope, username, config_key, value_json, description, created_at, updated_at
       FROM system_config WHERE scope = 'global' ORDER BY config_key ASC LIMIT ?`,
    )
    .all(limit) as SystemConfigRow[];
}

export function listUserConfigs(db: DatabaseSync, username: string, limit = 500): SystemConfigRow[] {
  const u = username.trim();
  if (!u) return [];
  return db
    .prepare(
      `SELECT id, scope, username, config_key, value_json, description, created_at, updated_at
       FROM system_config WHERE scope = 'user' AND username = ? ORDER BY config_key ASC LIMIT ?`,
    )
    .all(u, limit) as SystemConfigRow[];
}

function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** 管理台 / API 列表用：可选按 scope、用户名、config_key 子串筛选 */
export function listSystemConfigsFiltered(
  db: DatabaseSync,
  opts: {
    scope?: "global" | "user";
    username?: string;
    configKeyContains?: string;
    limit?: number;
  },
): SystemConfigRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const where: string[] = [];
  const params: SQLInputValue[] = [];

  if (opts.scope === "global") {
    where.push("scope = 'global'");
    where.push("username IS NULL");
  } else if (opts.scope === "user") {
    where.push("scope = 'user'");
    const u = opts.username?.trim();
    if (u) {
      where.push("username = ?");
      params.push(u);
    }
  } else {
    const uOnly = opts.username?.trim();
    if (uOnly) {
      where.push("scope = 'user'");
      where.push("username = ?");
      params.push(uOnly);
    }
  }

  const key = opts.configKeyContains?.trim();
  if (key) {
    where.push(`config_key LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLikePattern(key)}%`);
  }

  const wh = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `SELECT id, scope, username, config_key, value_json, description, created_at, updated_at
     FROM system_config ${wh} ORDER BY scope, COALESCE(username, ''), config_key LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params) as SystemConfigRow[];
}

export function upsertGlobalConfig(
  db: DatabaseSync,
  input: { config_key: string; value_json: string; description?: string },
): SystemConfigRow {
  const existing = getGlobalConfigByKey(db, input.config_key);
  if (existing) {
    return updateSystemConfig(db, existing.id, {
      value_json: input.value_json,
      description: input.description !== undefined ? input.description : existing.description,
    })!;
  }
  return createSystemConfig(db, {
    id: randomUUID(),
    scope: "global",
    username: null,
    config_key: input.config_key,
    value_json: input.value_json,
    description: input.description,
  });
}

export function upsertUserConfig(
  db: DatabaseSync,
  input: { username: string; config_key: string; value_json: string; description?: string },
): SystemConfigRow {
  const existing = getUserConfigByKey(db, input.username, input.config_key);
  if (existing) {
    return updateSystemConfig(db, existing.id, {
      value_json: input.value_json,
      description: input.description !== undefined ? input.description : existing.description,
    })!;
  }
  return createSystemConfig(db, {
    id: randomUUID(),
    scope: "user",
    username: input.username.trim(),
    config_key: input.config_key,
    value_json: input.value_json,
    description: input.description,
  });
}

export function updateSystemConfig(
  db: DatabaseSync,
  id: string,
  patch: UpdateSystemConfigPatch,
): SystemConfigRow | undefined {
  const row = getSystemConfig(db, id);
  if (!row) return undefined;
  const u = now();
  const next: SystemConfigRow = {
    ...row,
    config_key: patch.config_key ?? row.config_key,
    value_json: patch.value_json ?? row.value_json,
    description: patch.description !== undefined ? patch.description : row.description,
    updated_at: u,
  };
  db.prepare(
    `UPDATE system_config SET config_key = ?, value_json = ?, description = ?, updated_at = ? WHERE id = ?`,
  ).run(next.config_key, next.value_json, next.description, next.updated_at, id);
  return getSystemConfig(db, id);
}

export function deleteSystemConfig(db: DatabaseSync, id: string): boolean {
  const r = db.prepare(`DELETE FROM system_config WHERE id = ?`).run(id);
  return r.changes > 0;
}
