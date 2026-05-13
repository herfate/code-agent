import type { DatabaseSync } from "node:sqlite";
import type { ParentTaskRow } from "../parentTask.js";
import { TASK_STATUS, type TaskRow } from "../workflow.js";

const TASK_COLUMNS = `id, title, description, status, task_type, creator, pid, thread_id,
  input_json, output_json, error_message, meta_json,
  created_at, updated_at, started_at, completed_at`;

/** 扫描候选：子任务 + 关联父任务（必须存在） */
export type PendingTaskForScanRow = {
  task: TaskRow;
  parent_task: ParentTaskRow;
};

type PendingTaskForScanSqlRow = TaskRow & {
  parent_pid: string;
  parent_title: string;
  parent_description: string;
  parent_task_type: ParentTaskRow["task_type"];
  parent_created_at: number;
  parent_updated_at: number;
};

/**
 * 按父任务 `pid` 分组，每组取最早一条待执行任务；
 * 若该父任务下存在执行中或执行失败的子任务，则整组排除；
 * 内连接 `parent_task`（仅 `pid` 非空且父任务存在），结果按任务 `created_at` 升序。
 */
const SQL_PENDING_TASKS_FOR_SCAN_BY_PARENT = `
  SELECT
    t.id, t.title, t.description, t.status, t.task_type, t.creator, t.pid, t.thread_id,
    t.input_json, t.output_json, t.error_message, t.meta_json,
    t.created_at, t.updated_at, t.started_at, t.completed_at,
    p.pid AS parent_pid,
    p.title AS parent_title,
    p.description AS parent_description,
    p.task_type AS parent_task_type,
    p.created_at AS parent_created_at,
    p.updated_at AS parent_updated_at
  FROM (
    SELECT ${TASK_COLUMNS},
      ROW_NUMBER() OVER (
        PARTITION BY pid
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM tasks
    WHERE status = ? AND pid IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM tasks blocker
        WHERE blocker.pid = tasks.pid
          AND blocker.status IN (?, ?)
      )
  ) t
  INNER JOIN parent_task p ON p.pid = t.pid
  WHERE t.rn = 1
  ORDER BY t.created_at ASC
  LIMIT ?
`;

function mapPendingTaskForScanRow(row: PendingTaskForScanSqlRow): PendingTaskForScanRow {
  const task: TaskRow = {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    task_type: row.task_type,
    creator: row.creator,
    pid: row.pid,
    thread_id: row.thread_id,
    input_json: row.input_json,
    output_json: row.output_json,
    error_message: row.error_message,
    meta_json: row.meta_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };

  const parent_task: ParentTaskRow = {
    pid: row.parent_pid,
    title: row.parent_title,
    description: row.parent_description,
    task_type: row.parent_task_type,
    created_at: row.parent_created_at,
    updated_at: row.parent_updated_at,
  };

  return { task, parent_task };
}

/** 扫描队列：每个父任务下仅返回最早一条 Pending 任务（含父任务信息）；父任务下有 Running/Failed 时跳过 */
export function listPendingTasksForScanByParent(
  db: DatabaseSync,
  limit: number,
): PendingTaskForScanRow[] {
  const n = Math.min(500, Math.max(1, limit));
  const rows = db
    .prepare(SQL_PENDING_TASKS_FOR_SCAN_BY_PARENT)
    .all(
      TASK_STATUS.Pending,
      TASK_STATUS.Running,
      TASK_STATUS.Failed,
      n,
    ) as PendingTaskForScanSqlRow[];
  return rows.map(mapPendingTaskForScanRow);
}
