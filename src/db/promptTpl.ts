import type { DatabaseSync } from "node:sqlite";

/** 提示词模板配置（与表 `prompt_tpl` 对应） */
export type PromptTplRow = {
  id: number;
  /** 毫秒时间戳 */
  created_at: number;
  /** 毫秒时间戳 */
  updated_at: number;
  order_index: number | null;
  prompt: string | null;
  task_type: string | null;
  tpl_key: string | null;
  username: string | null;
};

export type CreatePromptTplInput = {
  order_index?: number | null;
  prompt?: string | null;
  task_type?: string | null;
  tpl_key?: string | null;
  username?: string | null;
};

export type UpdatePromptTplPatch = Partial<{
  order_index: number | null;
  prompt: string | null;
  task_type: string | null;
  tpl_key: string | null;
  username: string | null;
}>;

function now(): number {
  return Date.now();
}

function rowFromGet(r: unknown): PromptTplRow | undefined {
  if (!r || typeof r !== "object") return undefined;
  const o = r as Record<string, unknown>;
  return {
    id: Number(o.id),
    created_at: Number(o.created_at),
    updated_at: Number(o.updated_at),
    order_index: o.order_index === null || o.order_index === undefined ? null : Number(o.order_index),
    prompt: o.prompt === null || o.prompt === undefined ? null : String(o.prompt),
    task_type: o.task_type === null || o.task_type === undefined ? null : String(o.task_type),
    tpl_key: o.tpl_key === null || o.tpl_key === undefined ? null : String(o.tpl_key),
    username: o.username === null || o.username === undefined ? null : String(o.username),
  };
}

export function createPromptTpl(db: DatabaseSync, input: CreatePromptTplInput = {}): PromptTplRow {
  const t = now();
  const result = db
    .prepare(
      `INSERT INTO prompt_tpl (created_at, updated_at, order_index, prompt, task_type, tpl_key, username)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t,
      t,
      input.order_index ?? null,
      input.prompt ?? null,
      input.task_type ?? null,
      input.tpl_key ?? null,
      input.username ?? null,
    );
  const id = Number(result.lastInsertRowid);
  return getPromptTpl(db, id)!;
}

export function getPromptTpl(db: DatabaseSync, id: number): PromptTplRow | undefined {
  const r = db
    .prepare(
      `SELECT id, created_at, updated_at, order_index, prompt, task_type, tpl_key, username
       FROM prompt_tpl WHERE id = ?`,
    )
    .get(id);
  return rowFromGet(r);
}

export function listPromptTpl(db: DatabaseSync, limit = 500): PromptTplRow[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, updated_at, order_index, prompt, task_type, tpl_key, username
       FROM prompt_tpl ORDER BY COALESCE(task_type, ''), COALESCE(order_index, 0), id ASC LIMIT ?`,
    )
    .all(limit) as unknown[];
  return rows.map((r) => rowFromGet(r)!).filter(Boolean);
}

export function listPromptTplByTaskType(db: DatabaseSync, taskType: string, limit = 200): PromptTplRow[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, updated_at, order_index, prompt, task_type, tpl_key, username
       FROM prompt_tpl WHERE task_type = ?
       ORDER BY COALESCE(order_index, 0), id ASC LIMIT ?`,
    )
    .all(taskType, limit) as unknown[];
  return rows.map((r) => rowFromGet(r)!).filter(Boolean);
}

export function listPromptTplByTplKey(db: DatabaseSync, tplKey: string): PromptTplRow[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, updated_at, order_index, prompt, task_type, tpl_key, username
       FROM prompt_tpl WHERE tpl_key = ? ORDER BY COALESCE(order_index, 0), id ASC`,
    )
    .all(tplKey) as unknown[];
  return rows.map((r) => rowFromGet(r)!).filter(Boolean);
}

export function updatePromptTpl(
  db: DatabaseSync,
  id: number,
  patch: UpdatePromptTplPatch,
): PromptTplRow | undefined {
  const row = getPromptTpl(db, id);
  if (!row) return undefined;
  const u = now();
  const next: PromptTplRow = {
    ...row,
    order_index: patch.order_index !== undefined ? patch.order_index : row.order_index,
    prompt: patch.prompt !== undefined ? patch.prompt : row.prompt,
    task_type: patch.task_type !== undefined ? patch.task_type : row.task_type,
    tpl_key: patch.tpl_key !== undefined ? patch.tpl_key : row.tpl_key,
    username: patch.username !== undefined ? patch.username : row.username,
    updated_at: u,
  };
  db.prepare(
    `UPDATE prompt_tpl SET
       order_index = ?, prompt = ?, task_type = ?, tpl_key = ?, username = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.order_index,
    next.prompt,
    next.task_type,
    next.tpl_key,
    next.username,
    next.updated_at,
    id,
  );
  return getPromptTpl(db, id);
}

export function deletePromptTpl(db: DatabaseSync, id: number): boolean {
  const r = db.prepare(`DELETE FROM prompt_tpl WHERE id = ?`).run(id);
  return r.changes > 0;
}
