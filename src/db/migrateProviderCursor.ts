import type { DatabaseSync } from "node:sqlite";

function tableCheckIncludesCursor(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { sql?: string } | undefined;
  return row?.sql?.includes("'cursor'") === true;
}

/** 为历史库扩展 threads / agent_runs 的 provider CHECK，允许 `cursor`。 */
export function migrateProviderCursor(db: DatabaseSync): void {
  if (tableCheckIncludesCursor(db, "threads") && tableCheckIncludesCursor(db, "agent_runs")) {
    return;
  }

  try {
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("BEGIN IMMEDIATE");

    if (!tableCheckIncludesCursor(db, "threads")) {
      db.exec(`
        CREATE TABLE threads_new (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'cursor')),
          external_thread_id TEXT,
          created_at INTEGER NOT NULL
        );
      `);
      db.exec(`INSERT INTO threads_new SELECT * FROM threads`);
      db.exec(`DROP TABLE threads`);
      db.exec(`ALTER TABLE threads_new RENAME TO threads`);
    }

    if (!tableCheckIncludesCursor(db, "agent_runs")) {
      db.exec(`
        CREATE TABLE agent_runs_new (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'cursor')),
          status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
          error_message TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER
        );
      `);
      db.exec(`INSERT INTO agent_runs_new SELECT * FROM agent_runs`);
      db.exec(`DROP TABLE agent_runs`);
      db.exec(`ALTER TABLE agent_runs_new RENAME TO agent_runs`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, started_at DESC)`);
    }

    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    try {
      db.exec("PRAGMA foreign_keys=ON");
    } catch {
      /* ignore */
    }
  }
}
