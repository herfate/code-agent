import type { DatabaseSync } from "node:sqlite";
import {
  isTaskStatus,
  TASK_STATUS,
  type TaskStatus,
  taskStatusLabel,
} from "../constants/taskStatus.js";
import {
  SUBTASK_STATUS,
  type SubTaskStatus,
  subtaskStatusLabel,
} from "../constants/subtaskStatus.js";
import {
  parseTaskType,
  TASK_TYPE,
  TASK_TYPE_DEV,
  taskTypeLabel,
  type TaskType,
} from "../constants/taskType.js";

export type { TaskStatus };
export type { SubTaskStatus };
export type { TaskType };
export { TASK_STATUS, taskStatusLabel, SUBTASK_STATUS, subtaskStatusLabel };
export { TASK_TYPE, TASK_TYPE_DEV, taskTypeLabel, parseTaskType };

/** 工作流子任务（任务内的一个步骤 / 节点） */
export type SubTaskKind = "agent" | "tool" | "approval" | "script" | "human";

/** 与表 `tasks` 一一对应的持久化行 */
export type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** 任务类型：见 {@link TASK_TYPE} */
  task_type: TaskType;
  /** HTTPS 克隆时作为 token 的 Basic 用户名；空则沿用 `oauth2` 默认 */
  creator: string | null;
  pid: string | null;
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
  /** 累计执行耗时（毫秒），仅通过 {@link addTaskCost} 累加 */
  cost: number;
};

/** 与表 `subtasks` 一一对应的持久化行 */
export type SubTaskRow = {
  id: string;
  task_id: string;
  sort_order: number;
  title: string;
  description: string;
  status: SubTaskStatus;
  kind: SubTaskKind;
  /** JSON 字符串：本步骤出参 */
  result_json: string | null;
  error_message: string | null;
  retry_count: number;
  prompt_id: string | null;
  tpl_file_path: string | null;
  out_file_path: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
};

/** 父任务运行参数（与表 `parent_task_params` 对应；按 param_key 存运行所需配置） */
export type ParentTaskParamRow = {
  id: string;
  parent_task_id: string;
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
  creator?: string | null;
  pid?: string | null;
  thread_id?: string | null;
  input_json?: string | null;
  meta_json?: string | null;
  /** 省略时取当前时间；批量创建时可传入递增时间戳以便排序区分 */
  created_at?: number;
  updated_at?: number;
};

export type UpdateTaskPatch = Partial<{
  title: string;
  description: string;
  status: TaskStatus;
  task_type: TaskType;
  creator: string | null;
  pid: string | null;
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
  status?: SubTaskStatus;
  kind?: SubTaskKind;
  prompt_id?: string | null;
  tpl_file_path?: string | null;
  out_file_path?: string | null;
};

export type UpdateSubTaskPatch = Partial<{
  title: string;
  description: string;
  sort_order: number;
  status: SubTaskStatus;
  kind: SubTaskKind;
  result_json: string | null;
  error_message: string | null;
  retry_count: number;
  prompt_id: string | null;
  tpl_file_path: string | null;
  out_file_path: string | null;
  started_at: number | null;
  completed_at: number | null;
}>;

export type CreateParentTaskParamInput = {
  id: string;
  parent_task_id: string;
  param_key: string;
  value_json: string;
  description?: string;
};

export type UpdateParentTaskParamPatch = Partial<{
  param_key: string;
  value_json: string;
  description: string;
}>;

function now(): number {
  return Date.now();
}

/** tasks 表常用列（含累计耗时 cost） */
const TASK_SELECT_COLUMNS = `id, title, description, status, task_type, creator, pid, thread_id,
              input_json, output_json, error_message, meta_json,
              created_at, updated_at, started_at, completed_at, cost`;

export function createTask(db: DatabaseSync, input: CreateTaskInput): TaskRow {
  const t = input.created_at ?? now();
  const u = input.updated_at ?? t;
  const title = input.title ?? "";
  const description = input.description ?? "";
  const status = input.status ?? TASK_STATUS.Pending;
  const taskType = input.task_type ?? TASK_TYPE.Dev;
  const creator = input.creator?.trim() ? input.creator.trim() : null;
  db.prepare(
    `INSERT INTO tasks (
       id, title, description, status, task_type, creator, pid, thread_id,
       input_json, output_json, error_message, meta_json,
       created_at, updated_at, started_at, completed_at, cost
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, 0)`,
  ).run(
    input.id,
    title,
    description,
    status,
    taskType,
    creator,
    input.pid ?? null,
    input.thread_id ?? null,
    input.input_json ?? null,
    input.meta_json ?? null,
    t,
    u,
  );
  return getTask(db, input.id)!;
}

export function getTask(db: DatabaseSync, id: string): TaskRow | undefined {
  return db
    .prepare(`SELECT ${TASK_SELECT_COLUMNS} FROM tasks WHERE id = ?`)
    .get(id) as TaskRow | undefined;
}

/** 批量取多个父任务下子任务的 `status`（按 `pid` 分组） */
export function listTaskStatusesByPids(
  db: DatabaseSync,
  pids: string[],
): Map<string, TaskStatus[]> {
  const map = new Map<string, TaskStatus[]>();
  if (pids.length === 0) return map;
  const placeholders = pids.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT pid, status FROM tasks WHERE pid IN (${placeholders})`)
    .all(...pids) as Array<{ pid: string; status: number }>;
  for (const row of rows) {
    if (!isTaskStatus(row.status)) continue;
    const list = map.get(row.pid) ?? [];
    list.push(row.status);
    map.set(row.pid, list);
  }
  return map;
}

/** 按父任务 `pid` 列出关联任务（创建时间升序） */
export function listTasksByPid(db: DatabaseSync, pid: string): TaskRow[] {
  return db
    .prepare(`SELECT ${TASK_SELECT_COLUMNS} FROM tasks WHERE pid = ? ORDER BY created_at ASC`)
    .all(pid) as TaskRow[];
}

/** 按父任务 `pid` 取最近一条任务 */
export function getLatestTaskByPid(db: DatabaseSync, pid: string): TaskRow | undefined {
  const rows = listTasksByPid(db, pid);
  return rows.length > 0 ? rows[rows.length - 1] : undefined;
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

/**
 * 将已认领（执行中）的任务释放回待执行，保留 `started_at` 以便非阻塞等待类工具任务累计耗时。
 */
export function releaseClaimedTaskToPending(db: DatabaseSync, id: string): boolean {
  const t = now();
  const res = db
    .prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?`)
    .run(TASK_STATUS.Pending, t, id, TASK_STATUS.Running);
  return Number(res.changes) > 0;
}

export function listTasks(db: DatabaseSync, limit = 100): TaskRow[] {
  return db
    .prepare(`SELECT ${TASK_SELECT_COLUMNS} FROM tasks ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as TaskRow[];
}

export function listTasksByStatus(db: DatabaseSync, status: TaskStatus, limit = 100): TaskRow[] {
  return db
    .prepare(
      `SELECT ${TASK_SELECT_COLUMNS} FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
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
  const sql = `SELECT ${TASK_SELECT_COLUMNS} FROM tasks ${where} ORDER BY created_at DESC LIMIT ?`;
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
    creator: patch.creator !== undefined ? patch.creator : row.creator,
    pid: patch.pid !== undefined ? patch.pid : row.pid,
    thread_id: patch.thread_id !== undefined ? patch.thread_id : row.thread_id,
    input_json: patch.input_json !== undefined ? patch.input_json : row.input_json,
    output_json: patch.output_json !== undefined ? patch.output_json : row.output_json,
    error_message: patch.error_message !== undefined ? patch.error_message : row.error_message,
    meta_json: patch.meta_json !== undefined ? patch.meta_json : row.meta_json,
    started_at: patch.started_at !== undefined ? patch.started_at : row.started_at,
    completed_at: patch.completed_at !== undefined ? patch.completed_at : row.completed_at,
    // cost 仅由 addTaskCost 累加，此处保留原值
    cost: row.cost,
    updated_at: u,
  };
  db.prepare(
    `UPDATE tasks SET
       title = ?, description = ?, status = ?, task_type = ?, creator = ?, pid = ?, thread_id = ?,
       input_json = ?, output_json = ?, error_message = ?, meta_json = ?,
       updated_at = ?, started_at = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    next.title,
    next.description,
    next.status,
    next.task_type,
    next.creator,
    next.pid,
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

/**
 * 原子累加任务耗时（毫秒）。`deltaMs <= 0` 时不写库，直接返回当前行。
 */
export function addTaskCost(db: DatabaseSync, id: string, deltaMs: number): TaskRow | undefined {
  const row = getTask(db, id);
  if (!row) return undefined;
  const delta = Math.floor(deltaMs);
  if (!(delta > 0)) return row;
  const u = now();
  const res = db
    .prepare(`UPDATE tasks SET cost = cost + ?, updated_at = ? WHERE id = ?`)
    .run(delta, u, id);
  if (Number(res.changes) === 0) return undefined;
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
       id, task_id, sort_order, title, description, status, kind,
       result_json, error_message, retry_count,
       prompt_id, tpl_file_path, out_file_path,
       created_at, updated_at, started_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    input.id,
    input.task_id,
    sortOrder,
    title,
    description,
    status,
    kind,
    input.prompt_id ?? null,
    input.tpl_file_path ?? null,
    input.out_file_path ?? null,
    t,
    t,
  );
  return getSubTask(db, input.id)!;
}

export function getSubTask(db: DatabaseSync, id: string): SubTaskRow | undefined {
  return db
    .prepare(
      `SELECT id, task_id, sort_order, title, description, status, kind,
              result_json, error_message, retry_count,
              prompt_id, tpl_file_path, out_file_path,
              created_at, updated_at, started_at, completed_at
       FROM subtasks WHERE id = ?`,
    )
    .get(id) as SubTaskRow | undefined;
}

export function listSubTasksByTaskId(db: DatabaseSync, taskId: string): SubTaskRow[] {
  return db
    .prepare(
      `SELECT id, task_id, sort_order, title, description, status, kind,
              result_json, error_message, retry_count,
              prompt_id, tpl_file_path, out_file_path,
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
    sort_order: patch.sort_order ?? row.sort_order,
    status: patch.status ?? row.status,
    kind: patch.kind ?? row.kind,
    result_json: patch.result_json !== undefined ? patch.result_json : row.result_json,
    error_message: patch.error_message !== undefined ? patch.error_message : row.error_message,
    retry_count: patch.retry_count ?? row.retry_count,
    prompt_id: patch.prompt_id !== undefined ? patch.prompt_id : row.prompt_id,
    tpl_file_path: patch.tpl_file_path !== undefined ? patch.tpl_file_path : row.tpl_file_path,
    out_file_path: patch.out_file_path !== undefined ? patch.out_file_path : row.out_file_path,
    started_at: patch.started_at !== undefined ? patch.started_at : row.started_at,
    completed_at: patch.completed_at !== undefined ? patch.completed_at : row.completed_at,
    updated_at: u,
  };
  db.prepare(
    `UPDATE subtasks SET
       sort_order = ?, title = ?, description = ?, status = ?, kind = ?,
       result_json = ?, error_message = ?, retry_count = ?,
       prompt_id = ?, tpl_file_path = ?, out_file_path = ?,
       updated_at = ?, started_at = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    next.sort_order,
    next.title,
    next.description,
    next.status,
    next.kind,
    next.result_json,
    next.error_message,
    next.retry_count,
    next.prompt_id,
    next.tpl_file_path,
    next.out_file_path,
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

export function createParentTaskParam(
  db: DatabaseSync,
  input: CreateParentTaskParamInput,
): ParentTaskParamRow {
  const t = now();
  const description = input.description ?? "";
  db.prepare(
    `INSERT INTO parent_task_params (id, parent_task_id, param_key, value_json, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.parent_task_id, input.param_key, input.value_json, description, t, t);
  return getParentTaskParam(db, input.id)!;
}

/** 若已存在相同 parent_task_id + param_key 则更新值与说明，否则插入新行 */
export function upsertParentTaskParam(
  db: DatabaseSync,
  input: CreateParentTaskParamInput,
): ParentTaskParamRow {
  const existing = getParentTaskParamByParentAndKey(db, input.parent_task_id, input.param_key);
  if (existing) {
    return updateParentTaskParam(db, existing.id, {
      value_json: input.value_json,
      description: input.description !== undefined ? input.description : existing.description,
    })!;
  }
  return createParentTaskParam(db, input);
}

export function getParentTaskParam(db: DatabaseSync, id: string): ParentTaskParamRow | undefined {
  return db
    .prepare(
      `SELECT id, parent_task_id, param_key, value_json, description, created_at, updated_at
       FROM parent_task_params WHERE id = ?`,
    )
    .get(id) as ParentTaskParamRow | undefined;
}

export function getParentTaskParamByParentAndKey(
  db: DatabaseSync,
  parentTaskId: string,
  paramKey: string,
): ParentTaskParamRow | undefined {
  return db
    .prepare(
      `SELECT id, parent_task_id, param_key, value_json, description, created_at, updated_at
       FROM parent_task_params WHERE parent_task_id = ? AND param_key = ?`,
    )
    .get(parentTaskId, paramKey) as ParentTaskParamRow | undefined;
}

export function listParentTaskParamsByParentId(
  db: DatabaseSync,
  parentTaskId: string,
): ParentTaskParamRow[] {
  return db
    .prepare(
      `SELECT id, parent_task_id, param_key, value_json, description, created_at, updated_at
       FROM parent_task_params WHERE parent_task_id = ? ORDER BY param_key ASC`,
    )
    .all(parentTaskId) as ParentTaskParamRow[];
}

export function updateParentTaskParam(
  db: DatabaseSync,
  id: string,
  patch: UpdateParentTaskParamPatch,
): ParentTaskParamRow | undefined {
  const row = getParentTaskParam(db, id);
  if (!row) return undefined;
  const u = now();
  const next: ParentTaskParamRow = {
    ...row,
    param_key: patch.param_key ?? row.param_key,
    value_json: patch.value_json ?? row.value_json,
    description: patch.description !== undefined ? patch.description : row.description,
    updated_at: u,
  };
  db.prepare(
    `UPDATE parent_task_params SET param_key = ?, value_json = ?, description = ?, updated_at = ? WHERE id = ?`,
  ).run(next.param_key, next.value_json, next.description, next.updated_at, id);
  return getParentTaskParam(db, id);
}

export function deleteParentTaskParam(db: DatabaseSync, id: string): boolean {
  const r = db.prepare(`DELETE FROM parent_task_params WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function deleteParentTaskParamByParentAndKey(
  db: DatabaseSync,
  parentTaskId: string,
  paramKey: string,
): boolean {
  const r = db
    .prepare(`DELETE FROM parent_task_params WHERE parent_task_id = ? AND param_key = ?`)
    .run(parentTaskId, paramKey);
  return r.changes > 0;
}

/** 批量读取指定父任务在某 param_key 下的 value_json */
export function listParentTaskParamValueJsonByParentIdsAndKey(
  db: DatabaseSync,
  parentTaskIds: readonly string[],
  paramKey: string,
): Map<string, string> {
  const map = new Map<string, string>();
  if (parentTaskIds.length === 0) return map;
  const placeholders = parentTaskIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT parent_task_id, value_json
       FROM parent_task_params
       WHERE param_key = ? AND parent_task_id IN (${placeholders})`,
    )
    .all(paramKey, ...parentTaskIds) as { parent_task_id: string; value_json: string }[];
  for (const row of rows) {
    map.set(row.parent_task_id, row.value_json);
  }
  return map;
}
