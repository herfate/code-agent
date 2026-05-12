import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { isTaskStatus, type TaskStatus } from "../constants/taskStatus.js";
import { createTask, getTask, listTasks, listTasksFiltered } from "../db/workflow.js";
import { getClaudeAgentRunIdFromTaskMeta } from "../services/taskClaudeMeta.js";
import { pipeAgentRunReplayToSse } from "../sse/replayAgentRun.js";

const createTaskBody = z.object({
  app: z.string().trim().min(1).max(500),
  branch_version: z.string().trim().min(1).max(500),
  requirement: z.string().trim().min(1).max(50_000),
});

const listTasksQuery = z.object({
  status: z.coerce
    .number()
    .int()
    .refine((n): n is TaskStatus => isTaskStatus(n), { message: "invalid status" })
    .optional(),
  task_type: z.enum(["1"]).optional(),
  title: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export function registerTaskRoutes(app: FastifyInstance, deps: { db: DatabaseSync }): void {
  const { db } = deps;

  app.get("/api/tasks/:taskId/claude-agent-stream", async (request, reply) => {
    const taskIdParsed = z.string().uuid().safeParse((request.params as { taskId?: string }).taskId);
    if (!taskIdParsed.success) {
      return reply.status(400).send({ error: "invalid taskId" });
    }
    const task = getTask(db, taskIdParsed.data);
    if (!task) {
      return reply.status(404).send({ error: "task not found" });
    }
    const runId = getClaudeAgentRunIdFromTaskMeta(task.meta_json);
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

  app.post("/api/tasks", async (request, reply) => {
    const parsed = createTaskBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { app: appName, branch_version, requirement } = parsed.data;
    const id = randomUUID();
    const inputJson = JSON.stringify({
      app: appName,
      branch_version,
      requirement,
    });
    const task = createTask(db, {
      id,
      title: `${appName} / ${branch_version}`,
      description: requirement,
      task_type: "1",
      input_json: inputJson,
    });
    return reply.status(201).send({ task });
  });
}
