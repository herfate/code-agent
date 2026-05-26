import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PARENT_PARAM_KEY_INIT, RESERVED_PARENT_PARAM_KEYS } from "../constants/commonKey.js";
import {
  PARENT_AGENT_TYPE,
  parseParentAgentType,
  type ParentAgentType,
} from "../constants/parentAgentType.js";
import { PARENT_TASK_PLACEHOLDER_TITLE } from "../constants/parentTask.js";
import { createParentTaskParam, type ParentTaskParamRow } from "./workflow.js";

/** `param_key = init` 时 `value_json` 的对象结构 */
export type ParentTaskInitJson = {
  branch_version: string;
  gitRemoteUrl: string;
  /** 测试环境标识（如 QA 环境名） */
  testEnv: string;
};

export function buildParentTaskInitValueJson(
  branch_version: string,
  gitRemoteUrl?: string,
  testEnv?: string,
): string {
  const payload: ParentTaskInitJson = {
    branch_version,
    gitRemoteUrl: gitRemoteUrl?.trim() ?? "",
    testEnv: testEnv?.trim() ?? "",
  };
  return JSON.stringify(payload);
}

/** 解析 `parent_task_params` 中 `init` 参数的 `value_json` */
export function parseParentTaskInitJson(valueJson: string | null | undefined): ParentTaskInitJson {
  if (!valueJson?.trim()) {
    return { branch_version: "", gitRemoteUrl: "", testEnv: "" };
  }
  try {
    const raw = JSON.parse(valueJson) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { branch_version: "", gitRemoteUrl: "", testEnv: "" };
    }
    const o = raw as Record<string, unknown>;
    const str = (key: keyof ParentTaskInitJson): string =>
      typeof o[key] === "string" ? (o[key] as string) : "";
    return {
      branch_version: str("branch_version"),
      gitRemoteUrl: str("gitRemoteUrl"),
      testEnv: str("testEnv"),
    };
  } catch {
    return { branch_version: "", gitRemoteUrl: "", testEnv: "" };
  }
}

/** 父任务（与表 `parent_task` 对应） */
export type ParentTaskRow = {
  pid: string;
  title: string;
  description: string;
  /** 父任务 Agent 类型，默认 {@link PARENT_AGENT_TYPE.DevSelfTest} */
  task_type: ParentAgentType;
  /** 毫秒时间戳 */
  created_at: number;
  /** 毫秒时间戳 */
  updated_at: number;
};

export type CreateParentTaskInput = {
  pid: string;
  title?: string;
  description?: string;
  task_type?: ParentAgentType;
};

/** 写入 `parent_task_params` 的额外运行参数（不含 `init`） */
export type CreateParentTaskExtraParamInput = {
  id?: string;
  param_key: string;
  value_json: string;
  description?: string;
};

/** 创建父任务并写入参数表（`init` 参数含 branch_version、gitRemoteUrl、testEnv） */
export type CreateParentTaskWithParamsInput = CreateParentTaskInput & {
  branch_version: string;
  gitRemoteUrl?: string;
  testEnv?: string;
  extraParams?: CreateParentTaskExtraParamInput[];
};

export type CreateParentTaskWithParamsResult = {
  parent_task: ParentTaskRow;
  parent_task_params: ParentTaskParamRow[];
};

export type UpdateParentTaskPatch = Partial<{
  title: string;
  description: string;
  task_type: ParentAgentType;
}>;

function now(): number {
  return Date.now();
}

function rowFromGet(r: unknown): ParentTaskRow | undefined {
  if (!r || typeof r !== "object") return undefined;
  const o = r as Record<string, unknown>;
  return {
    pid: String(o.pid),
    title: String(o.title ?? ""),
    description: String(o.description ?? ""),
    task_type: parseParentAgentType(o.task_type),
    created_at: Number(o.created_at),
    updated_at: Number(o.updated_at),
  };
}

/** 将 `init` 参数（含 branch_version、gitRemoteUrl、testEnv）写入 `parent_task_params` */
function insertInitParentTaskParam(
  db: DatabaseSync,
  parentTaskId: string,
  branch_version: string,
  gitRemoteUrl?: string,
  testEnv?: string,
): ParentTaskParamRow {
  return createParentTaskParam(db, {
    id: randomUUID(),
    parent_task_id: parentTaskId,
    param_key: PARENT_PARAM_KEY_INIT,
    value_json: buildParentTaskInitValueJson(branch_version, gitRemoteUrl, testEnv),
  });
}

/** 创建父任务并写入参数表（无事务，供外层编排同一事务调用） */
export function createParentTaskWithParamsCore(
  db: DatabaseSync,
  input: CreateParentTaskWithParamsInput,
): CreateParentTaskWithParamsResult {
  const extra = input.extraParams ?? [];
  for (const p of extra) {
    if ((RESERVED_PARENT_PARAM_KEYS as readonly string[]).includes(p.param_key)) {
      throw new Error(`param_key "${p.param_key}" is reserved`);
    }
  }
  const keys = extra.map((p) => p.param_key);
  if (new Set(keys).size !== keys.length) {
    throw new Error("duplicate param_key in extraParams");
  }
  const parent_task = createParentTask(db, input);
  const parent_task_params: ParentTaskParamRow[] = [
    insertInitParentTaskParam(db, input.pid, input.branch_version, input.gitRemoteUrl, input.testEnv),
    ...extra.map((p) =>
      createParentTaskParam(db, {
        id: p.id ?? randomUUID(),
        parent_task_id: input.pid,
        param_key: p.param_key,
        value_json: p.value_json,
        description: p.description,
      }),
    ),
  ];
  return { parent_task, parent_task_params };
}

/** 创建父任务行，并写入 `init` 及其它参数到 `parent_task_params`（独立事务） */
export function createParentTaskWithParams(
  db: DatabaseSync,
  input: CreateParentTaskWithParamsInput,
): CreateParentTaskWithParamsResult {
  db.exec("BEGIN");
  try {
    const result = createParentTaskWithParamsCore(db, input);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function createParentTask(db: DatabaseSync, input: CreateParentTaskInput): ParentTaskRow {
  const t = now();
  const title = input.title?.trim() || PARENT_TASK_PLACEHOLDER_TITLE;
  const description = input.description ?? "";
  const taskType = input.task_type ?? PARENT_AGENT_TYPE.DevSelfTest;
  db.prepare(
    `INSERT INTO parent_task (pid, title, description, task_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.pid, title, description, taskType, t, t);
  return getParentTask(db, input.pid)!;
}

/** 取当前表中数值型 pid 的最大值 +1，作为新父任务默认主键（无记录时为 `"1"`） */
export function nextParentTaskPid(db: DatabaseSync): string {
  const rows = db.prepare(`SELECT pid FROM parent_task`).all() as Array<{ pid: string }>;
  let max = 0;
  for (const { pid } of rows) {
    if (!/^\d+$/.test(pid)) continue;
    const n = Number(pid);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return String(max + 1);
}

export function getParentTask(db: DatabaseSync, pid: string): ParentTaskRow | undefined {
  const r = db
    .prepare(
      `SELECT pid, title, description, task_type, created_at, updated_at
       FROM parent_task WHERE pid = ?`,
    )
    .get(pid);
  return rowFromGet(r);
}

export function listParentTasks(
  db: DatabaseSync,
  filters: {
    task_type?: ParentAgentType;
    titleContains?: string;
    creator?: string;
    limit?: number;
  } = {},
): ParentTaskRow[] {
  const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.task_type) {
    clauses.push("task_type = ?");
    params.push(filters.task_type);
  }
  const raw = filters.titleContains?.trim();
  if (raw) {
    clauses.push(`title LIKE ? ESCAPE '\\'`);
    const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    params.push("%" + esc + "%");
  }
  const creator = filters.creator?.trim();
  if (creator) {
    clauses.push(
      `EXISTS (SELECT 1 FROM tasks t WHERE t.pid = parent_task.pid AND t.creator = ?)`,
    );
    params.push(creator);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT pid, title, description, task_type, created_at, updated_at
     FROM parent_task ${where} ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as unknown[];
  return rows.map((r) => rowFromGet(r)!).filter(Boolean);
}

export function updateParentTask(
  db: DatabaseSync,
  pid: string,
  patch: UpdateParentTaskPatch,
): ParentTaskRow | undefined {
  const row = getParentTask(db, pid);
  if (!row) return undefined;
  const u = now();
  const next: ParentTaskRow = {
    ...row,
    title: patch.title !== undefined ? patch.title : row.title,
    description: patch.description !== undefined ? patch.description : row.description,
    task_type: patch.task_type !== undefined ? patch.task_type : row.task_type,
    updated_at: u,
  };
  db.prepare(
    `UPDATE parent_task SET title = ?, description = ?, task_type = ?, updated_at = ? WHERE pid = ?`,
  ).run(next.title, next.description, next.task_type, next.updated_at, pid);
  return getParentTask(db, pid);
}

export function deleteParentTask(db: DatabaseSync, pid: string): boolean {
  const r = db.prepare(`DELETE FROM parent_task WHERE pid = ?`).run(pid);
  return r.changes > 0;
}
