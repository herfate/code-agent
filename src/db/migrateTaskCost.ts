import type { DatabaseSync } from "node:sqlite";

function tasksHasCostColumn(db: DatabaseSync): boolean {
  const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  return cols.some((c) => c.name === "cost");
}

/** 为历史库 `tasks` 表增加累计耗时字段 `cost`（毫秒）。新库由 initSql 直接建列。 */
export function migrateTaskCost(db: DatabaseSync): void {
  if (tasksHasCostColumn(db)) return;
  db.exec(`ALTER TABLE tasks ADD COLUMN cost INTEGER NOT NULL DEFAULT 0`);
}
