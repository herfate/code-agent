import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { getGitlabUrlForAppLookup } from "../constants/appCatalog.js";
import { isTaskStatus, TASK_STATUS, type TaskStatus } from "../constants/taskStatus.js";
import { TASK_TYPE } from "../constants/taskType.js";
import { loadConfig } from "../config.js";
import { resolveParentTaskAgentProvider } from "../db/parentTask.js";
import { getAgentRun } from "../db/agentRun.js";
import { createTask, getTask, listTasks, listTasksFiltered, updateTask } from "../db/workflow.js";
import { abortClaudeAgentRun } from "../services/agentsdk/claudeAgent.js";
import { abortCursorAgentRun } from "../services/agentsdk/cursorAgent.js";
import {
  getAgentRunIdFromTaskMeta,
  stripAgentRunIdsForRequeue,
} from "../services/taskAgentMeta.js";
import { TASK_RUN_AGENT_PROVIDER } from "../constants/agentProvider.js";
import { zTaskCreator } from "../validation/taskCreatorZod.js";
import { zTaskTypeOptional } from "../validation/taskTypeZod.js";
import { pipeAgentRunReplayToSse } from "../sse/replayAgentRun.js";
import { matrixSheetsToExcelBuffer, type MatrixSheet } from "../services/file/exportMatrixToExcel.js";
import { contentDispositionAttachment } from "../services/file/contentDisposition.js";

const createTaskBody = z.object({
  app: z.string().trim().min(1).max(500),
  branch_version: z.string().trim().min(1).max(500),
  requirement: z.string().trim().min(1).max(50_000),
  creator: zTaskCreator,
});

const patchTaskBody = z
  .object({
    status: z.coerce
      .number()
      .int()
      .refine((n): n is TaskStatus => isTaskStatus(n), { message: "invalid status" })
      .optional(),
    description: z.string().max(50_000).optional(),
  })
  .refine((b) => b.status !== undefined || b.description !== undefined, {
    message: "at least one of status, description is required",
  });

const listTasksQuery = z.object({
  status: z.coerce
    .number()
    .int()
    .refine((n): n is TaskStatus => isTaskStatus(n), { message: "invalid status" })
    .optional(),
  task_type: zTaskTypeOptional,
  title: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const durationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const durationByParentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const DURATION_TASK_COLUMNS = `id, title, status, started_at, completed_at`;

export function registerTaskRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/tasks/:taskId", async (request, reply) => {
    const taskIdParsed = z.string().uuid().safeParse((request.params as { taskId?: string }).taskId);
    if (!taskIdParsed.success) {
      return reply.status(400).send({ error: "invalid taskId" });
    }
    const task = getTask(db, taskIdParsed.data);
    if (!task) {
      return reply.status(404).send({ error: "task not found" });
    }
    const config = loadConfig();
    const agent_provider = task.pid?.trim()
      ? resolveParentTaskAgentProvider(db, task.pid.trim(), config.TASK_AGENT_PROVIDER, task.task_type)
      : config.TASK_AGENT_PROVIDER;
    return { task, agent_provider };
  });

  app.get("/api/tasks/:taskId/claude-agent-stream", async (request, reply) => {
    const taskIdParsed = z.string().uuid().safeParse((request.params as { taskId?: string }).taskId);
    if (!taskIdParsed.success) {
      return reply.status(400).send({ error: "invalid taskId" });
    }
    const task = getTask(db, taskIdParsed.data);
    if (!task) {
      return reply.status(404).send({ error: "task not found" });
    }
    const runId = getAgentRunIdFromTaskMeta(task.meta_json, TASK_RUN_AGENT_PROVIDER.Claude);
    if (!runId) {
      return reply.status(404).send({ error: "no claude run for this task" });
    }
    const runIdParsed = z.string().uuid().safeParse(runId);
    if (!runIdParsed.success) {
      return reply.status(400).send({ error: "invalid claudeAgentRunId in task meta" });
    }
    const q = (request.query as { afterSeq?: string }).afterSeq;
    const afterSeq = z.coerce.number().int().min(0).safeParse(q ?? 0);
    const after = afterSeq.success ? afterSeq.data : 0;
    await pipeAgentRunReplayToSse(reply, db, runIdParsed.data, after);
  });

  app.get("/api/tasks/:taskId/cursor-agent-stream", async (request, reply) => {
    const taskIdParsed = z.string().uuid().safeParse((request.params as { taskId?: string }).taskId);
    if (!taskIdParsed.success) {
      return reply.status(400).send({ error: "invalid taskId" });
    }
    const task = getTask(db, taskIdParsed.data);
    if (!task) {
      return reply.status(404).send({ error: "task not found" });
    }
    const runId = getAgentRunIdFromTaskMeta(task.meta_json, TASK_RUN_AGENT_PROVIDER.Cursor);
    if (!runId) {
      return reply.status(404).send({ error: "no cursor run for this task" });
    }
    const runIdParsed = z.string().uuid().safeParse(runId);
    if (!runIdParsed.success) {
      return reply.status(400).send({ error: "invalid cursorAgentRunId in task meta" });
    }
    const q = (request.query as { afterSeq?: string }).afterSeq;
    const afterSeq = z.coerce.number().int().min(0).safeParse(q ?? 0);
    const after = afterSeq.success ? afterSeq.data : 0;
    await pipeAgentRunReplayToSse(reply, db, runIdParsed.data, after);
  });

  /** 强制中断任务当前正在执行的 Agent（Claude / Cursor） */
  app.post("/api/tasks/:taskId/agent-abort", async (request, reply) => {
    const taskIdParsed = z.string().uuid().safeParse((request.params as { taskId?: string }).taskId);
    if (!taskIdParsed.success) {
      return reply.status(400).send({ error: "invalid taskId" });
    }
    const task = getTask(db, taskIdParsed.data);
    if (!task) {
      return reply.status(404).send({ error: "task not found" });
    }
    const config = loadConfig();
    const provider = task.pid?.trim()
      ? resolveParentTaskAgentProvider(db, task.pid.trim(), config.TASK_AGENT_PROVIDER, task.task_type)
      : config.TASK_AGENT_PROVIDER;
    const runId = getAgentRunIdFromTaskMeta(task.meta_json, provider);
    if (!runId) {
      return reply.status(404).send({ error: "no agent run for this task" });
    }
    const runIdParsed = z.string().uuid().safeParse(runId);
    if (!runIdParsed.success) {
      return reply.status(400).send({ error: "invalid agent run id in task meta" });
    }
    const run = getAgentRun(db, runIdParsed.data);
    if (!run) {
      return reply.status(404).send({ error: "run not found" });
    }
    if (run.status !== "running") {
      return reply.status(409).send({ error: "run already finished", status: run.status });
    }
    const aborted =
      provider === TASK_RUN_AGENT_PROVIDER.Cursor
        ? abortCursorAgentRun(runIdParsed.data)
        : abortClaudeAgentRun(runIdParsed.data);
    if (!aborted) {
      return reply.status(409).send({ error: "run not active in this process", runId: runIdParsed.data, provider });
    }
    return { ok: true, runId: runIdParsed.data, provider };
  });

  app.patch("/api/tasks/:taskId", async (request, reply) => {
    const taskIdParsed = z.string().uuid().safeParse((request.params as { taskId?: string }).taskId);
    if (!taskIdParsed.success) {
      return reply.status(400).send({ error: "invalid taskId" });
    }
    const parsed = patchTaskBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const existing = getTask(db, taskIdParsed.data);
    if (!existing) {
      return reply.status(404).send({ error: "task not found" });
    }
    const { status: nextStatus, description: descPatch } = parsed.data;
    if (descPatch !== undefined && !descPatch.trim()) {
      return reply.status(400).send({ error: "description 不能为空" });
    }
    const patch: Parameters<typeof updateTask>[2] = {
      ...(descPatch !== undefined ? { description: descPatch } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
    };
    if (nextStatus === TASK_STATUS.Pending) {
      Object.assign(patch, {
        error_message: null,
        output_json: null,
        started_at: null,
        completed_at: null,
        thread_id: null,
        meta_json: stripAgentRunIdsForRequeue(existing.meta_json),
      });
    }
    const task = updateTask(db, taskIdParsed.data, patch);
    if (!task) {
      return reply.status(404).send({ error: "task not found" });
    }
    return { task };
  });

  app.get("/api/tasks", async (request, reply) => {
    const parsed = listTasksQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const q = parsed.data;
    const hasFilter =
      q.status !== undefined ||
      q.task_type !== undefined ||
      (q.title !== undefined && q.title.trim() !== "");
    if (hasFilter) {
      return {
        tasks: listTasksFiltered(db, {
          status: q.status,
          task_type: q.task_type,
          titleContains: q.title?.trim() || undefined,
          limit: q.limit,
        }),
      };
    }
    return { tasks: listTasks(db, q.limit ?? 100) };
  });

  /** 单个任务耗时列表（SQL 1：started_at & completed_at 均有值的任务，按耗时倒序） */
  app.get("/api/tasks/duration-list", async (request, reply) => {
    const parsed = durationListQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const limit = parsed.data.limit ?? 50;
    const rows = db
      .prepare(
        `SELECT ${DURATION_TASK_COLUMNS},
                ROUND((completed_at - started_at) / 1000.0, 2) AS duration_seconds,
                ROUND((completed_at - started_at) / 1000.0 / 60, 2) AS duration_minutes
         FROM tasks
         WHERE started_at IS NOT NULL AND completed_at IS NOT NULL
         ORDER BY duration_minutes DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
        id: string;
        title: string;
        status: number;
        started_at: number;
        completed_at: number;
        duration_seconds: number;
        duration_minutes: number;
      }>;
    return { tasks: rows };
  });

  /** 按父任务维度统计耗时（SQL 7：关联 parent_task，按 pid 聚合子任务耗时） */
  app.get("/api/tasks/duration-by-parent", async (request, reply) => {
    const parsed = durationByParentQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const limit = parsed.data.limit ?? 20;
    const rows = db
      .prepare(
        `SELECT t.pid,
                pt.title AS parent_title,
                COUNT(*) AS subtask_count,
                ROUND(SUM(t.completed_at - t.started_at) / 1000.0 / 60, 2) AS total_duration_minutes,
                ROUND(AVG(t.completed_at - t.started_at) / 1000.0 / 60, 2) AS avg_duration_minutes
         FROM tasks t
         LEFT JOIN parent_task pt ON t.pid = pt.pid
         WHERE t.started_at IS NOT NULL AND t.completed_at IS NOT NULL
           AND t.pid IS NOT NULL AND t.pid <> ''
         GROUP BY t.pid, pt.title
         ORDER BY total_duration_minutes DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
        pid: string;
        parent_title: string | null;
        subtask_count: number;
        total_duration_minutes: number;
        avg_duration_minutes: number;
      }>;
    return { items: rows };
  });

  /** 导出任务耗时统计为 Excel（scope: all | tasks | parent） */
  app.get("/api/tasks/duration-export", async (request, reply) => {
    const scopeRaw = (request.query as { scope?: string }).scope ?? "all";
    const scope = scopeRaw === "tasks" || scopeRaw === "parent" ? scopeRaw : "all";
    const pad = (n: number) => String(n).padStart(2, "0");
    const formatTime = (ts: number | null): string => {
      if (!ts) return "-";
      const d = new Date(ts);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const statusLabel = (s: number): string => {
      switch (s) {
        case 1: return "待执行";
        case 2: return "执行中";
        case 3: return "执行完成";
        case 4: return "执行失败";
        case 5: return "已暂停";
        case 6: return "已取消";
        default: return String(s);
      }
    };

    const sheets: MatrixSheet[] = [];

    if (scope === "all" || scope === "tasks") {
      const taskRows = db
        .prepare(
          `SELECT ${DURATION_TASK_COLUMNS},
                  ROUND((completed_at - started_at) / 1000.0 / 60, 2) AS duration_minutes
           FROM tasks
           WHERE started_at IS NOT NULL AND completed_at IS NOT NULL
           ORDER BY duration_minutes DESC
           LIMIT 500`,
        )
        .all() as Array<{
          id: string;
          title: string;
          status: number;
          started_at: number;
          completed_at: number;
          duration_minutes: number;
        }>;
      sheets.push({
        sheetName: "任务耗时明细",
        headers: ["序号", "任务标题", "状态", "耗时(分钟)", "耗时(小时)", "开始时间", "完成时间"],
        rows: taskRows.map((t, i) => [
          String(i + 1),
          t.title ?? "",
          statusLabel(t.status),
          String(t.duration_minutes),
          (t.duration_minutes / 60).toFixed(2),
          formatTime(t.started_at),
          formatTime(t.completed_at),
        ]),
      });
    }

    if (scope === "all" || scope === "parent") {
      const parentRows = db
        .prepare(
          `SELECT t.pid,
                  pt.title AS parent_title,
                  COUNT(*) AS subtask_count,
                  ROUND(SUM(t.completed_at - t.started_at) / 1000.0 / 60, 2) AS total_duration_minutes,
                  ROUND(AVG(t.completed_at - t.started_at) / 1000.0 / 60, 2) AS avg_duration_minutes
           FROM tasks t
           LEFT JOIN parent_task pt ON t.pid = pt.pid
           WHERE t.started_at IS NOT NULL AND t.completed_at IS NOT NULL
             AND t.pid IS NOT NULL AND t.pid <> ''
           GROUP BY t.pid, pt.title
           ORDER BY total_duration_minutes DESC
           LIMIT 100`,
        )
        .all() as Array<{
          pid: string;
          parent_title: string | null;
          subtask_count: number;
          total_duration_minutes: number;
          avg_duration_minutes: number;
        }>;
      sheets.push({
        sheetName: "父任务维度统计",
        headers: ["序号", "父任务", "子任务数", "总耗时(分钟)", "平均耗时(分钟)", "总耗时(小时)"],
        rows: parentRows.map((p, i) => [
          String(i + 1),
          p.parent_title ?? "",
          String(p.subtask_count),
          String(p.total_duration_minutes),
          String(p.avg_duration_minutes),
          (p.total_duration_minutes / 60).toFixed(2),
        ]),
      });
    }

    if (sheets.length === 0) {
      return reply.status(400).send({ error: "nothing to export" });
    }

    try {
      const buf = await matrixSheetsToExcelBuffer(sheets);
      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      reply.header("Content-Disposition", contentDispositionAttachment("任务耗时统计.xlsx"));
      return reply.send(buf);
    } catch (err) {
      request.log.error(err, "export duration excel failed");
      return reply.status(500).send({ error: "export excel failed" });
    }
  });

  app.post("/api/tasks", async (request, reply) => {
    const parsed = createTaskBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { app: appName, branch_version, requirement, creator } = parsed.data;
    const id = randomUUID();
    const gitRemoteUrl = getGitlabUrlForAppLookup(appName);
    const gitRepos = gitRemoteUrl ? [{ gitRemoteUrl, branch_version }] : [];
    const inputJson = JSON.stringify({
      app: appName,
      requirement,
      gitRepos,
    });
    const task = createTask(db, {
      id,
      title: `${appName} / ${branch_version}`,
      description: requirement,
      task_type: TASK_TYPE.Dev,
      creator,
      input_json: inputJson,
    });
    return reply.status(201).send({ task });
  });
}
