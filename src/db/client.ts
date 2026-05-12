import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateTasksSubtasksStatusToNumeric } from "./migrateTaskStatusNumeric.js";

let db: DatabaseSync | null = null;

function ensureDirForFile(filePath: string) {
  const dir = path.dirname(path.resolve(filePath));
  fs.mkdirSync(dir, { recursive: true });
}

const initSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
  external_thread_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL CHECK (status BETWEEN 1 AND 6),
  task_type TEXT NOT NULL DEFAULT '1',
  workflow_def_id TEXT,
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

CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_thread ON tasks(thread_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_order ON subtasks(task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_status ON subtasks(task_id, status);

CREATE TABLE IF NOT EXISTS task_params (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  param_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (task_id, param_key)
);

CREATE INDEX IF NOT EXISTS idx_task_params_task ON task_params(task_id);

CREATE TABLE IF NOT EXISTS prompt_tpl (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  order_index INTEGER,
  prompt TEXT,
  task_type TEXT,
  tpl_key TEXT,
  username TEXT
);

CREATE INDEX IF NOT EXISTS idx_prompt_tpl_task_type_order ON prompt_tpl(task_type, order_index);
CREATE INDEX IF NOT EXISTS idx_prompt_tpl_tpl_key ON prompt_tpl(tpl_key);

CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'user')),
  username TEXT,
  config_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (scope = 'global' AND username IS NULL)
    OR (scope = 'user' AND username IS NOT NULL AND length(trim(username)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_global_key ON system_config(config_key) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_user_key ON system_config(username, config_key) WHERE scope = 'user';
CREATE INDEX IF NOT EXISTS idx_system_config_user_lookup ON system_config(scope, username);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_events (
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_name TEXT NOT NULL CHECK (event_name IN ('message', 'done', 'error')),
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run ON agent_run_events(run_id, seq);
`;

function migrateTasksTaskType(database: DatabaseSync): void {
  const cols = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "task_type")) {
    database.exec(`ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT '1'`);
  }
  database.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type)`);
}

export function getDb(databasePath: string): DatabaseSync {
  if (db) return db;
  ensureDirForFile(databasePath);
  const resolved = path.resolve(databasePath);
  db = new DatabaseSync(resolved);
  db.exec(initSql);
  migrateTasksSubtasksStatusToNumeric(db);
  migrateTasksTaskType(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
