import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { RESERVED_PARENT_PARAM_KEYS } from "../constants/commonKey.js";
import { getParentTask, listParentTasks, nextParentTaskPid } from "../db/parentTask.js";
import { PARENT_AGENT_TYPE } from "../constants/parentAgentType.js";
import { TASK_TYPE } from "../constants/taskType.js";
import {
  listParentTaskParamsByParentId,
  listSubTasksByTaskId,
  listTasksByPid,
} from "../db/workflow.js";
import { zTaskCreator } from "../validation/taskCreatorZod.js";
import { zParentAgentTypeOptional } from "../validation/parentAgentTypeZod.js";
import { zTaskAgentProviderEnumOptional } from "../validation/agentProviderZod.js";
import { createParentTaskWorkflow } from "../services/create/task/parentTaskCreateService.js";
import {
  buildParentTaskTitleSource,
  summarizeParentTaskTitleAsync,
} from "../services/create/task/parentTaskTitleAsync.js";
import { PARENT_TASK_PLACEHOLDER_TITLE } from "../constants/parentTask.js";

const listQuery = z.object({
  /** 按主键精确查询单条；有值时忽略其它筛选并只返回该条 */
  pid: z.string().trim().min(1).max(200).optional(),
  task_type: zParentAgentTypeOptional,
  title: z.string().max(200).optional(),
  /** 精确匹配关联 `tasks.creator`（存在至少一条子任务命中） */
  creator: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const valueJsonField = z.union([
  z.string().max(100_000),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.number(),
  z.boolean(),
  z.null(),
]);

const createParamItem = z.object({
  id: z.string().uuid().optional(),
  param_key: z.string().trim().min(1).max(200),
  value_json: valueJsonField,
  description: z.string().max(2000).optional(),
});

const createBody = z.object({
  /** 省略时由服务端分配为 max(数值型 pid)+1 */
  pid: z.string().trim().min(1).max(200).optional(),
  title: z.string().max(500).optional(),
  description: z.string().max(50_000).optional(),
  task_type: zParentAgentTypeOptional,
  branch_version: z.string().trim().min(1).max(500),
  gitRemoteUrl: z.string().trim().min(1).max(2000).optional(),
  testEnv: z.string().trim().min(1).max(200).optional(),
  /** 写入 `init` 参数的 Agent 线路；省略时使用 `TASK_AGENT_PROVIDER` */
  provider: zTaskAgentProviderEnumOptional,
  app: z.string().trim().min(1).max(500).optional(),
  requirement: z.string().trim().min(1).max(50_000).optional(),
  creator: zTaskCreator,
  params: z.array(createParamItem).max(100).optional(),
});

/** 将请求中的 value_json 规范为存库的 JSON 字符串 */
function normalizeValueJson(raw: z.infer<typeof valueJsonField>): string {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) throw new Error("value_json must not be empty");
    JSON.parse(t);
    return t;
  }
  return JSON.stringify(raw);
}

export function registerParentTaskRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/parent-tasks", async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const q = parsed.data;
    if (q.pid) {
      const row = getParentTask(db, q.pid);
      if (!row) {
        return reply.status(404).send({ error: "parent task not found" });
      }
      const parent_task_params = listParentTaskParamsByParentId(db, q.pid);
      const tasks = listTasksByPid(db, q.pid);
      const task = tasks.find((t) => t.task_type === TASK_TYPE.Dev) ?? tasks[0];
      const subtasks = task ? listSubTasksByTaskId(db, task.id) : [];
      const tasks_with_subtasks = tasks.map((t) => ({
        ...t,
        subtasks: listSubTasksByTaskId(db, t.id),
      }));
      return {
        parent_task: row,
        parent_task_params,
        tasks,
        task,
        subtasks,
        tasks_with_subtasks,
      };
    }
    const rows = listParentTasks(db, {
      task_type: q.task_type,
      titleContains: q.title?.trim() || undefined,
      creator: q.creator,
      limit: q.limit,
    });
    return { parent_tasks: rows };
  });

  app.post("/api/parent-tasks", async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const {
      title,
      description,
      task_type,
      branch_version,
      gitRemoteUrl,
      testEnv,
      provider,
      app,
      requirement,
      creator,
      params,
    } = parsed.data;
    const config = loadConfig();
    const pid = parsed.data.pid?.trim() || nextParentTaskPid(db);
    if (getParentTask(db, pid)) {
      return reply.status(409).send({ error: "parent task already exists" });
    }
    const paramItems = params ?? [];
    for (const p of paramItems) {
      if ((RESERVED_PARENT_PARAM_KEYS as readonly string[]).includes(p.param_key)) {
        return reply.status(400).send({
          error: `param_key "${p.param_key}" is reserved; use top-level field instead`,
        });
      }
    }
    const keys = paramItems.map((p) => p.param_key);
    if (new Set(keys).size !== keys.length) {
      return reply.status(400).send({ error: "duplicate param_key in params" });
    }
    let extraParams;
    try {
      extraParams = paramItems.map((p) => ({
        id: p.id ?? randomUUID(),
        param_key: p.param_key,
        value_json: normalizeValueJson(p.value_json),
        description: p.description,
      }));
    } catch {
      return reply.status(400).send({ error: "invalid value_json" });
    }

    const explicitTitle = title?.trim();
    const createTitle = explicitTitle || PARENT_TASK_PLACEHOLDER_TITLE;

    try {
      const result = createParentTaskWorkflow(db, {
        pid,
        title: createTitle,
        description,
        task_type: task_type ?? PARENT_AGENT_TYPE.DevSelfTest,
        branch_version,
        gitRemoteUrl,
        testEnv,
        provider: provider ?? config.TASK_AGENT_PROVIDER,
        app,
        requirement,
        creator,
        extraParams,
      });
      if (!explicitTitle) {
        const sourceText = buildParentTaskTitleSource({
          requirement,
          description,
          app,
          branch_version,
        });
        void summarizeParentTaskTitleAsync(db, pid, sourceText);
      }
      return reply.status(201).send(result);
    } catch (err) {
      request.log.error(err, "create parent task failed");
      const msg = err instanceof Error ? err.message : "create parent task failed";
      if (
        msg.includes("reserved") ||
        msg.includes("duplicate param_key") ||
        msg.includes("creator is required")
      ) {
        return reply.status(400).send({ error: msg });
      }
      return reply.status(500).send({ error: "create parent task failed" });
    }
  });
}
