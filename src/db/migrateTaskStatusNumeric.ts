import type { DatabaseSync } from "node:sqlite";

function tasksStatusIsInteger(db: DatabaseSync): boolean {
  const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string; type: string }[];
  const c = cols.find((x) => x.name === "status");
  return c !== undefined && c.type.toUpperCase() === "INTEGER";
}

/**
 * 将历史库中 `tasks.status` / `subtasks.status` 从英文 TEXT 迁为 1–6 的 INTEGER（新库由 initSql 直接建 INTEGER）。
 */
export function migrateTasksSubtasksStatusToNumeric(db: DatabaseSync): void {
  if (tasksStatusIsInteger(db)) return;

  try {
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("BEGIN IMMEDIATE");

    db.exec(`
    CREATE TEMP TABLE _m_subtasks AS SELECT * FROM subtasks;
    CREATE TEMP TABLE _m_parent_task_params AS SELECT * FROM task_params;
  `);

    db.exec(`
    CREATE TABLE tasks_new (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL CHECK (status BETWEEN 1 AND 6),
      task_type TEXT NOT NULL DEFAULT '1',
      pid TEXT,
      thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
      input_json TEXT,
      output_json TEXT,
      error_message TEXT,
      meta_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
  `);

    db.prepare(
      `INSERT INTO tasks_new SELECT
       id, title, description,
       CASE TRIM(CAST(status AS TEXT))
         WHEN 'pending' THEN 1
         WHEN 'running' THEN 2
         WHEN 'completed' THEN 3
         WHEN 'failed' THEN 4
         WHEN 'paused' THEN 5
         WHEN 'cancelled' THEN 6
         WHEN '1' THEN 1
         WHEN '2' THEN 2
         WHEN '3' THEN 3
         WHEN '4' THEN 4
         WHEN '5' THEN 5
         WHEN '6' THEN 6
         ELSE 1
       END,
       task_type, workflow_def_id, thread_id,
       input_json, output_json, error_message, meta_json,
       created_at, updated_at, started_at, completed_at
     FROM tasks`,
    ).run();

    db.exec(`
    CREATE TABLE subtasks_new (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks_new(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      step_key TEXT,
      status INTEGER NOT NULL CHECK (status BETWEEN 1 AND 6),
      kind TEXT NOT NULL DEFAULT 'agent' CHECK (kind IN ('agent', 'tool', 'approval', 'script', 'human')),
      payload_json TEXT,
      result_json TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
  `);

    db.prepare(
      `INSERT INTO subtasks_new SELECT
       id, task_id, sort_order, title, description, step_key,
       CASE TRIM(CAST(status AS TEXT))
         WHEN 'pending' THEN 1
         WHEN 'running' THEN 2
         WHEN 'completed' THEN 3
         WHEN 'failed' THEN 4
         WHEN 'skipped' THEN 5
         WHEN 'cancelled' THEN 6
         WHEN '1' THEN 1
         WHEN '2' THEN 2
         WHEN '3' THEN 3
         WHEN '4' THEN 4
         WHEN '5' THEN 5
         WHEN '6' THEN 6
         ELSE 1
       END,
       kind, payload_json, result_json, error_message, retry_count,
       created_at, updated_at, started_at, completed_at
     FROM _m_subtasks`,
    ).run();

    db.exec(`
    CREATE TABLE parent_task_params_new (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT NOT NULL,
      param_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (parent_task_id, param_key)
    );
  `);

    db.prepare(
      `INSERT INTO parent_task_params_new (id, parent_task_id, param_key, value_json, description, created_at, updated_at)
       SELECT id, task_id, param_key, value_json, description, created_at, updated_at FROM _m_parent_task_params`,
    ).run();

    db.exec(`
    DROP TABLE subtasks;
    DROP TABLE task_params;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
    ALTER TABLE subtasks_new RENAME TO subtasks;
    ALTER TABLE parent_task_params_new RENAME TO parent_task_params;
  `);

    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_thread ON tasks(thread_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
    CREATE INDEX IF NOT EXISTS idx_subtasks_task_order ON subtasks(task_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_subtasks_task_status ON subtasks(task_id, status);
    CREATE INDEX IF NOT EXISTS idx_parent_task_params_parent ON parent_task_params(parent_task_id);
  `);

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
