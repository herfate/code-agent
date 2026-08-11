import type { DatabaseSync } from "node:sqlite";
import type { Provider } from "./repository.js";

export type AgentRunRow = {
  id: string;
  thread_id: string;
  provider: Provider;
  status: "running" | "completed" | "failed";
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
};

export type AgentRunEventRow = {
  run_id: string;
  seq: number;
  event_name: "message" | "done" | "error";
  payload_json: string;
  created_at: number;
};

export function createAgentRun(db: DatabaseSync, input: { id: string; thread_id: string; provider: Provider }): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO agent_runs (id, thread_id, provider, status, error_message, started_at, completed_at)
     VALUES (?, ?, ?, 'running', NULL, ?, NULL)`,
  ).run(input.id, input.thread_id, input.provider, now);
}

export function getAgentRun(db: DatabaseSync, id: string): AgentRunRow | undefined {
  return db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as AgentRunRow | undefined;
}

export function finishAgentRun(
  db: DatabaseSync,
  id: string,
  patch: { status: "completed" | "failed"; error_message?: string | null },
): void {
  const now = Date.now();
  db.prepare(`UPDATE agent_runs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?`).run(
    patch.status,
    patch.error_message ?? null,
    now,
    id,
  );
}

/** 写入一条 run 事件，返回序号与落库时间（毫秒），供 SSE 一并下发 */
export function appendAgentRunEvent(
  db: DatabaseSync,
  runId: string,
  eventName: "message" | "done" | "error",
  payload: unknown,
): { seq: number; created_at: number } {
  const now = Date.now();
  const row = db.prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM agent_run_events WHERE run_id = ?`).get(runId) as {
    m: number;
  };
  const seq = row.m + 1;
  db.prepare(
    `INSERT INTO agent_run_events (run_id, seq, event_name, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(runId, seq, eventName, JSON.stringify(payload), now);
  return { seq, created_at: now };
}

export function listAgentRunEventsAfter(
  db: DatabaseSync,
  runId: string,
  afterSeq: number,
  limit = 500,
): AgentRunEventRow[] {
  return db
    .prepare(
      `SELECT run_id, seq, event_name, payload_json, created_at
       FROM agent_run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(runId, afterSeq, limit) as AgentRunEventRow[];
}
