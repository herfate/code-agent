import type { DatabaseSync } from "node:sqlite";
import type { AgentProvider } from "../constants/agentProvider.js";

/** @deprecated 使用 {@link AgentProvider} */
export type Provider = AgentProvider;

export type ThreadRow = {
  id: string;
  title: string;
  provider: Provider;
  external_thread_id: string | null;
  created_at: number;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  provider_message_id: string | null;
  created_at: number;
};

export function createThread(
  db: DatabaseSync,
  input: { id: string; title?: string; provider: Provider; external_thread_id?: string | null },
): ThreadRow {
  const now = Date.now();
  const title = input.title ?? "";
  db.prepare(
    `INSERT INTO threads (id, title, provider, external_thread_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.id, title, input.provider, input.external_thread_id ?? null, now);
  return {
    id: input.id,
    title,
    provider: input.provider,
    external_thread_id: input.external_thread_id ?? null,
    created_at: now,
  };
}

export function updateThreadExternalId(db: DatabaseSync, threadId: string, externalId: string): void {
  db.prepare(`UPDATE threads SET external_thread_id = ? WHERE id = ?`).run(externalId, threadId);
}

export function getThread(db: DatabaseSync, id: string): ThreadRow | undefined {
  return db.prepare(`SELECT id, title, provider, external_thread_id, created_at FROM threads WHERE id = ?`).get(id) as
    | ThreadRow
    | undefined;
}

export function listThreads(db: DatabaseSync, limit = 100): ThreadRow[] {
  return db
    .prepare(`SELECT id, title, provider, external_thread_id, created_at FROM threads ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ThreadRow[];
}

export function listThreadsFiltered(
  db: DatabaseSync,
  filters: { provider?: Provider; titleContains?: string; limit?: number } = {},
): ThreadRow[] {
  const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.provider) {
    clauses.push("provider = ?");
    params.push(filters.provider);
  }
  const raw = filters.titleContains?.trim();
  if (raw) {
    clauses.push(`title LIKE ? ESCAPE '\\'`);
    const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    params.push("%" + esc + "%");
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT id, title, provider, external_thread_id, created_at FROM threads ${where} ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params) as ThreadRow[];
}

export function insertMessage(
  db: DatabaseSync,
  input: {
    id: string;
    thread_id: string;
    role: MessageRow["role"];
    content: string;
    provider_message_id?: string | null;
  },
): MessageRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, provider_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.thread_id, input.role, input.content, input.provider_message_id ?? null, now);
  return {
    id: input.id,
    thread_id: input.thread_id,
    role: input.role,
    content: input.content,
    provider_message_id: input.provider_message_id ?? null,
    created_at: now,
  };
}

export function listMessages(db: DatabaseSync, threadId: string, limit = 200): MessageRow[] {
  return db
    .prepare(
      `SELECT id, thread_id, role, content, provider_message_id, created_at
       FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?`,
    )
    .all(threadId, limit) as MessageRow[];
}
