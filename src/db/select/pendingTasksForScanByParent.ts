import type { DatabaseSync } from "node:sqlite";
import type { ParentTaskRow } from "../parentTask.js";
import { TASK_STATUS, type TaskRow } from "../workflow.js";

const TASK_COLUMNS = `id, title, description, status, task_type, creator, pid, thread_id,
  input_json, output_json, error_message, meta_json,
  created_at, updated_at, started_at, completed_at, cost`;

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
 * 若该父任务下存在执行中、执行失败或已暂停的子任务，则整组排除；
 * 若同一 `creator` 已在其他父任务（同自然日，按 `parent_task.created_at` 本地时区）下有执行中的子任务，则排除（同用户同日父任务不并行；次日及以后的不阻塞当日）；
 * 但 `init.parallel` 为 true 的父任务跳过上述同日互斥，且不占用「每用户每轮一条」配额；
 * 结果按 creator 再分组，每用户仅保留一条非并行任务（便于 tick 内不同用户同时跑）；
 * 内连接 `parent_task`，按父任务 `created_at`、子任务 `created_at` 升序。
 */
const SQL_PENDING_TASKS_FOR_SCAN_BY_PARENT = `
  SELECT
    ranked.id, ranked.title, ranked.description, ranked.status, ranked.task_type, ranked.creator,
    ranked.pid, ranked.thread_id, ranked.input_json, ranked.output_json, ranked.error_message,
    ranked.meta_json, ranked.created_at, ranked.updated_at, ranked.started_at, ranked.completed_at,
    ranked.cost,
    ranked.parent_pid,
    ranked.parent_title,
    ranked.parent_description,
    ranked.parent_task_type,
    ranked.parent_created_at,
    ranked.parent_updated_at
  FROM (
    SELECT
      t.id, t.title, t.description, t.status, t.task_type, t.creator, t.pid, t.thread_id,
      t.input_json, t.output_json, t.error_message, t.meta_json,
      t.created_at, t.updated_at, t.started_at, t.completed_at, t.cost,
      p.pid AS parent_pid,
      p.title AS parent_title,
      p.description AS parent_description,
      p.task_type AS parent_task_type,
      p.created_at AS parent_created_at,
      p.updated_at AS parent_updated_at,
      ROW_NUMBER() OVER (
        PARTITION BY CASE
          WHEN COALESCE(json_extract(init_param.value_json, '$.parallel'), 0) = 1
            THEN t.id
          ELSE COALESCE(t.creator, '')
        END
        ORDER BY p.created_at ASC, t.created_at ASC, t.id ASC
      ) AS creator_rn
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
            AND blocker.status IN (?, ?, ?)
        )
        AND (
          EXISTS (
            SELECT 1
            FROM parent_task_params cur_init
            WHERE cur_init.parent_task_id = tasks.pid
              AND cur_init.param_key = 'init'
              AND COALESCE(json_extract(cur_init.value_json, '$.parallel'), 0) = 1
          )
          OR NOT EXISTS (
            SELECT 1
            FROM tasks other_running
            INNER JOIN parent_task other_parent ON other_parent.pid = other_running.pid
            INNER JOIN parent_task cur_parent ON cur_parent.pid = tasks.pid
            WHERE other_running.status = ?
              AND other_running.pid IS NOT NULL
              AND other_running.pid != tasks.pid
              AND COALESCE(other_running.creator, '') = COALESCE(tasks.creator, '')
              AND date(other_parent.created_at / 1000, 'unixepoch', 'localtime')
                = date(cur_parent.created_at / 1000, 'unixepoch', 'localtime')
          )
        )
    ) t
    INNER JOIN parent_task p ON p.pid = t.pid
    LEFT JOIN parent_task_params init_param
      ON init_param.parent_task_id = t.pid AND init_param.param_key = 'init'
    WHERE t.rn = 1
  ) ranked
  WHERE ranked.creator_rn = 1
  ORDER BY ranked.parent_created_at ASC, ranked.created_at ASC
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
    cost: row.cost,
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

/** 扫描队列：每父任务一条 Pending；同 creator 默认同日不并行（`init.parallel` 除外）；每轮每用户最多一条非并行任务 */
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
      TASK_STATUS.Paused,
      TASK_STATUS.Running,
      n,
    ) as PendingTaskForScanSqlRow[];
  return rows.map(mapPendingTaskForScanRow);
}
