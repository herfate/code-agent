import type { DatabaseSync } from "node:sqlite";
import {
  TASK_STATUS,
  type TaskStatus,
  taskStatusLabel,
} from "../constants/taskStatus.js";
import {
  SUBTASK_STATUS,
  type SubTaskStatus,
  subtaskStatusLabel,
} from "../constants/subtaskStatus.js";

export type { TaskStatus };
export type { SubTaskStatus };
export { TASK_STATUS, taskStatusLabel, SUBTASK_STATUS, subtaskStatusLabel };

/** `tasks.task_type`：`1` = 开发任务（后续可扩展其它取值） */
export type TaskType = "1";
export const TASK_TYPE_DEV: TaskType = "1";

export function taskTypeLabel(code: string): string {
  switch (code) {
    case "1":
      return "开发任务";
    default:
      return code;
  }
}

/** 工作流子任务（任务内的一个步骤 / 节点） */
export type SubTaskKind = "agent" | "tool" | "approval" | "script" | "human";

/** 与表 `tasks` 一一对应的持久化行 */
export type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** 任务类型：`1` = 开发任务 */
  task_type: TaskType;
  workflow_def_id: string | null;
  thread_id: string | null;
  /** JSON 字符串：工作流入参 */
  input_json: string | null;
  /** JSON 字符串：工作流汇总出参 */
  output_json: string | null;
  error_message: string | null;
  /** JSON 字符串：扩展元数据 */
  meta_json: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
};

/** 与表 `subtasks` 一一对应的持久化行 */
export type SubTaskRow = {
  id: string;
  task_id: string;
  sort_order: number;
  title: string;
  description: string;
  step_key: string | null;
  status: SubTaskStatus;
  kind: SubTaskKind;
  /** JSON 字符串：本步骤入参 */
  payload_json: string | null;
  /** JSON 字符串：本步骤出参 */
  result_json: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
};

/** 任务运行参数（与表 `task_params` 对应；按 param_key 存运行所需配置） */
export type TaskParamRow = {
  id: string;
  task_id: string;
  param_key: string;
  /** JSON 字符串：任意合法 JSON */
  value_json: string;
  description: string;
  created_at: number;
  updated_at: number;
};

export type CreateTaskInput = {
  id: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  task_type?: TaskType;
  workflow_def_id?: string | null;
  thread_id?: string | null;
  input_json?: string | null;
  meta_json?: string | null;
};

export type UpdateTaskPatch = Partial<{
  title: string;
  description: string;
  status: TaskStatus;
  task_type: TaskType;
  workflow_def_id: string | null;
  thread_id: string | null;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  meta_json: string | null;
  started_at: number | null;
  completed_at: number | null;
}>;

export type CreateSubTaskInput = {
  id: string;
  task_id: string;
  sort_order?: number;
  title?: string;
  description?: string;
  step_key?: string | null;
  status?: SubTaskStatus;
  kind?: SubTaskKind;
  payload_json?: string | null;
};

export type UpdateSubTaskPatch = Partial<{
  title: string;
  description: string;
  step_key: string | null;
  sort_order: number;
  status: SubTaskStatus;
  kind: SubTaskKind;
  payload_json: string | null;
  result_json: string | null;
  error_message: string | null;
  retry_count: number;
  started_at: number | null;
  completed_at: number | null;
}>;

export type CreateTaskParamInput = {
  id: string;
  task_id: string;
  param_key: string;
  value_json: string;
  description?: string;
};

export type UpdateTaskParamPatch = Partial<{
  param_key: string;
  value_json: string;
  description: string;
}>;

function now(): number {
  return Date.now();
}

export function createTask(db: DatabaseSync, input: CreateTaskInput): TaskRow {
  const t = now();
  const title = input.title ?? "";
  const description = input.description ?? "";
  const status = input.status ?? TASK_STATUS.Pending;
  const taskType = input.task_type ?? TASK_TYPE_DEV;
  db.prepare(
    `INSERT INTO tasks (
       id, title, description, status, task_type, workflow_def_id, thread_id,
       input_json, output_json, error_message, meta_json,
       created_at, updated_at, started_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL)`,
  ).run(
    input.id,
    title,
    description,
    status,
    taskType,
    input.workflow_def_id ?? null,
    input.thread_id ?? null,
    input.input_json ?? null,
    input.meta_json ?? null,
    t,
    t,
  );
  return getTask(db, input.id)!;
}

export function getTask(db: DatabaseSync, id: string): TaskRow | undefined {
  return db
    .prepare(
      `SELECT id, title, description, status, task_type, workflow_def_id, thread_id,
              input_json, output_json, error_message, meta_json,
              created_at, updated_at, started_at, completed_at
       FROM tasks WHERE id = ?`,
    )
    .get(id) as TaskRow | undefined;
}

/**
 * 若当前为待执行（1），原子更新为执行中（2）并返回最新行；否则返回 `undefined`（便于多 tick / 多进程下避免重复认领）。
 */
export function claimTaskIfPending(db: DatabaseSync, id: string): TaskRow | undefined {
  const t = now();
  const res = db
    .prepare(
      `UPDATE tasks SET status = ?, updated_at = ?, started_at = COALESCE(started_at, ?)
       WHERE id = ? AND status = ?`,
    )
    .run(TASK_STATUS.Running, t, t, id, TASK_STATUS.Pending);
  if (Number(res.changes) === 0) return undefined;
  return getTask(db, id);
}

/** 待执行任务队列扫描：状态 1 按创建时间升序（先入先出）。 */
export function listPendingTasksForScan(db: DatabaseSync, limit = 10): TaskRow[] {
  const n = Math.min(500, Math.max(1, limit));
  return db
    .prepare(
      `SELECT id, title, description, status, task_type, workflow_def_id, thread_id,
              input_json, output_json, error_message, meta_json,
              created_at, updated_at, started_at, completed_at
       FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT ?`,
    )
    .all(TASK_STATUS.Pending, n) as TaskRow[];
}

export function listTasks(db: DatabaseSync, limit = 100): TaskRow[] {
  return db
    .prepare(
      `SELECT id, title, description, status, task_type, workflow_def_id, thread_id,
              input_json, output_json, error_message, meta_json,
              created_at, updated_at, started_at, completed_at
       FROM tasks ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as TaskRow[];
}

export function listTasksByStatus(db: DatabaseSync, status: TaskStatus, limit = 100): TaskRow[] {
  return db
    .prepare(
      `SELECT id, title, description, status, task_type, workflow_def_id, thread_id,
              input_json, output_json, error_message, meta_json,
              created_at, updated_at, started_at, completed_at
       FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(status, limit) as TaskRow[];
}

export function listTasksFiltered(
  db: DatabaseSync,
  filters: { status?: TaskStatus; task_type?: TaskType; titleContains?: string; limit?: number } = {},
): TaskRow[] {
  const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.task_type) {
    clauses.push("task_type = ?");
    params.push(filters.task_type);
  }
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  const raw = filters.titleContains?.trim();
  if (raw) {
    clauses.push(`title LIKE ? ESCAPE '\\'`);
    const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    params.push("%" + esc + "%");
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT id, title, description, status, task_type, workflow_def_id, thread_id,
              input_json, output_json, error_message, meta_json,
              created_at, updated_at, started_at, completed_at
       FROM tasks ${where} ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params) as TaskRow[];
}

export function updateTask(db: DatabaseSync, id: string, patch: UpdateTaskPatch): TaskRow | undefined {
  const row = getTask(db, id);
  if (!row) return undefined;
  const u = now();
  const next: TaskRow = {
    ...row,
    title: patch.title ?? row.title,
    description: patch.description ?? row.description,
    status: patch.status ?? row.status,
    task_type: patch.task_type ?? row.task_type,
    workflow_def_id: patch.workflow_def_id !== undefined ? patch.workflow_def_id : row.workflow_def_id,
    thread_id: patch.thread_id !== undefined ? patch.thread_id : row.thread_id,
    input_json: patch.input_json !== undefined ? patch.input_json : row.input_json,
    output_json: patch.output_json !== undefined ? patch.output_json : row.output_json,
    error_message: patch.error_message !== undefined ? patch.error_message : row.error_message,
    meta_json: patch.meta_json !== undefined ? patch.meta_json : row.meta_json,
    started_at: patch.started_at !== undefined ? patch.started_at : row.started_at,
    completed_at: patch.completed_at !== undefined ? patch.completed_at : row.completed_at,
    updated_at: u,
  };
  db.prepare(
    `UPDATE tasks SET
       title = ?, description = ?, status = ?, task_type = ?, workflow_def_id = ?, thread_id = ?,
       input_json = ?, output_json = ?, error_message = ?, meta_json = ?,
       updated_at = ?, started_at = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    next.title,
    next.description,
    next.status,
    next.task_type,
    next.workflow_def_id,
    next.thread_id,
    next.input_json,
    next.output_json,
    next.error_message,
    next.meta_json,
    next.updated_at,
    next.started_at,
    next.completed_at,
    id,
  );
  return getTask(db, id);
}

export function deleteTask(db: DatabaseSync, id: string): boolean {
  const r = db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function createSubTask(db: DatabaseSync, input: CreateSubTaskInput): SubTaskRow {
  const t = now();
  const title = input.title ?? "";
  const description = input.description ?? "";
  const status = input.status ?? SUBTASK_STATUS.Pending;
  const kind = input.kind ?? "agent";
  const sortOrder = input.sort_order ?? 0;
  db.prepare(
    `INSERT INTO subtasks (
       id, task_id, sort_order, title, description, step_key, status, kind,
       payload_json, result_json, error_message, retry_count,
       created_at, updated_at, started_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, NULL, NULL)`,
  ).run(
    input.id,
    input.task_id,
    sortOrder,
    title,
    description,
    input.step_key ?? null,
    status,
    kind,
    input.payload_json ?? null,
    t,
    t,
  );
  return getSubTask(db, input.id)!;
}

export function getSubTask(db: DatabaseSync, id: string): SubTaskRow | undefined {
  return db
    .prepare(
      `SELECT id, task_id, sort_order, title, description, step_key, status, kind,
              payload_json, result_json, error_message, retry_count,
              created_at, updated_at, started_at, completed_at
       FROM subtasks WHERE id = ?`,
    )
    .get(id) as SubTaskRow | undefined;
}

export function listSubTasksByTaskId(db: DatabaseSync, taskId: string): SubTaskRow[] {
  return db
    .prepare(
      `SELECT id, task_id, sort_order, title, description, step_key, status, kind,
              payload_json, result_json, error_message, retry_count,
              created_at, updated_at, started_at, completed_at
       FROM subtasks WHERE task_id = ? ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(taskId) as SubTaskRow[];
}

export function updateSubTask(db: DatabaseSync, id: string, patch: UpdateSubTaskPatch): SubTaskRow | undefined {
  const row = getSubTask(db, id);
  if (!row) return undefined;
  const u = now();
  const next: SubTaskRow = {
    ...row,
    title: patch.title ?? row.title,
    description: patch.description ?? row.description,
    step_key: patch.step_key !== undefined ? patch.step_key : row.step_key,
    sort_order: patch.sort_order ?? row.sort_order,
    status: patch.status ?? row.status,
    kind: patch.kind ?? row.kind,
    payload_json: patch.payload_json !== undefined ? patch.payload_json : row.payload_json,
    result_json: patch.result_json !== undefined ? patch.result_json : row.result_json,
    error_message: patch.error_message !== undefined ? patch.error_message : row.error_message,
    retry_count: patch.retry_count ?? row.retry_count,
    started_at: patch.started_at !== undefined ? patch.started_at : row.started_at,
    completed_at: patch.completed_at !== undefined ? patch.completed_at : row.completed_at,
    updated_at: u,
  };
  db.prepare(
    `UPDATE subtasks SET
       sort_order = ?, title = ?, description = ?, step_key = ?, status = ?, kind = ?,
       payload_json = ?, result_json = ?, error_message = ?, retry_count = ?,
       updated_at = ?, started_at = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    next.sort_order,
    next.title,
    next.description,
    next.step_key,
    next.status,
    next.kind,
    next.payload_json,
    next.result_json,
    next.error_message,
    next.retry_count,
    next.updated_at,
    next.started_at,
    next.completed_at,
    id,
  );
  return getSubTask(db, id);
}

export function deleteSubTask(db: DatabaseSync, id: string): boolean {
  const r = db.prepare(`DELETE FROM subtasks WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function createTaskParam(db: DatabaseSync, input: CreateTaskParamInput): TaskParamRow {
  const t = now();
  const description = input.description ?? "";
  db.prepare(
    `INSERT INTO task_params (id, task_id, param_key, value_json, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.task_id, input.param_key, input.value_json, description, t, t);
  return getTaskParam(db, input.id)!;
}

/** 若已存在相同 task_id + param_key 则更新值与说明，否则插入新行 */
export function upsertTaskParam(db: DatabaseSync, input: CreateTaskParamInput): TaskParamRow {
  const existing = getTaskParamByTaskAndKey(db, input.task_id, input.param_key);
  if (existing) {
    return updateTaskParam(db, existing.id, {
      value_json: input.value_json,
      description: input.description !== undefined ? input.description : existing.description,
    })!;
  }
  return createTaskParam(db, input);
}

export function getTaskParam(db: DatabaseSync, id: string): TaskParamRow | undefined {
  return db
    .prepare(
      `SELECT id, task_id, param_key, value_json, description, created_at, updated_at
       FROM task_params WHERE id = ?`,
    )
    .get(id) as TaskParamRow | undefined;
}

export function getTaskParamByTaskAndKey(
  db: DatabaseSync,
  taskId: string,
  paramKey: string,
): TaskParamRow | undefined {
  return db
    .prepare(
      `SELECT id, task_id, param_key, value_json, description, created_at, updated_at
       FROM task_params WHERE task_id = ? AND param_key = ?`,
    )
    .get(taskId, paramKey) as TaskParamRow | undefined;
}

export function listTaskParamsByTaskId(db: DatabaseSync, taskId: string): TaskParamRow[] {
  return db
    .prepare(
      `SELECT id, task_id, param_key, value_json, description, created_at, updated_at
       FROM task_params WHERE task_id = ? ORDER BY param_key ASC`,
    )
    .all(taskId) as TaskParamRow[];
}

export function updateTaskParam(
  db: DatabaseSync,
  id: string,
  patch: UpdateTaskParamPatch,
): TaskParamRow | undefined {
  const row = getTaskParam(db, id);
  if (!row) return undefined;
  const u = now();
  const next: TaskParamRow = {
    ...row,
    param_key: patch.param_key ?? row.param_key,
    value_json: patch.value_json ?? row.value_json,
    description: patch.description !== undefined ? patch.description : row.description,
    updated_at: u,
  };
  db.prepare(
    `UPDATE task_params SET param_key = ?, value_json = ?, description = ?, updated_at = ? WHERE id = ?`,
  ).run(next.param_key, next.value_json, next.description, next.updated_at, id);
  return getTaskParam(db, id);
}

export function deleteTaskParam(db: DatabaseSync, id: string): boolean {
  const r = db.prepare(`DELETE FROM task_params WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function deleteTaskParamByTaskAndKey(db: DatabaseSync, taskId: string, paramKey: string): boolean {
  const r = db.prepare(`DELETE FROM task_params WHERE task_id = ? AND param_key = ?`).run(taskId, paramKey);
  return r.changes > 0;
}
