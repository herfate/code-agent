import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { PARENT_PARAM_KEY_INIT, RESERVED_PARENT_PARAM_KEYS } from "../constants/commonKey.js";
import {
  isUserEditableParentParamKey,
  normalizeTestCaseAdoptionRateValue,
  parseTestCaseAdoptionRateValueJson,
  TEST_CASE_ADOPTION_RATE_PARAM_KEY,
} from "../constants/testCaseAdoptionRateParamKey.js";
import {
  countParentTasks,
  getParentTask,
  listParentTasks,
  nextParentTaskPid,
} from "../db/parentTask.js";
import { PARENT_AGENT_TYPE, parseParentAgentTypesCsv } from "../constants/parentAgentType.js";
import { TASK_TYPE } from "../constants/taskType.js";
import { aggregateParentExecStatus } from "../constants/taskStatus.js";
import {
  listParentTaskParamValueJsonByParentIdsAndKey,
  listParentTaskParamsByParentId,
  listSubTasksByTaskId,
  listTaskStatusesByPids,
  listTasksByPid,
  upsertParentTaskParam,
} from "../db/workflow.js";
import { zParentAgentTypeOptional } from "../validation/parentAgentTypeZod.js";
import {
  normalizeParentTaskParamValueJson,
  zCreateParentTaskBody,
} from "../validation/parentTaskCreateZod.js";
import { createParentTaskWorkflow } from "../services/create/task/parentTaskCreateService.js";
import {
  buildParentTaskTitleSource,
  summarizeParentTaskTitleAsync,
  summarizeTitleFromSourceText,
} from "../services/create/task/parentTaskTitleAsync.js";
import {
  isParentTaskTitlePendingAi,
  PARENT_TASK_PLACEHOLDER_TITLE,
} from "../constants/parentTask.js";
import { listBrainstormStoriesForPid } from "../services/brainstorm/listBrainstormStories.js";
import { readLatestAiOutMarkdown, readAiOutMarkdownByTaskId, listAiOutMarkdownTaskTypes, readAiOutAsset } from "../services/file/readLatestAiOutMarkdown.js";
import {
  findAutotestCaseJsonFilesInAiOut,
  findAutotestMdFilesInAiOut,
} from "../services/file/findAutotestCaseJsonFilesInAiOut.js";
import { findLatestTestCaseDesignInAiOut } from "../services/file/findLatestTestCaseDesignInAiOut.js";
import { autotestCaseToExcelBuffer } from "../services/file/exportAutotestCaseToExcel.js";
import { testCaseDesignToExcelBuffer } from "../services/file/exportTestCaseDesignToExcel.js";
import { autotestCaseExcelFilename } from "../services/file/parseAutotestCaseJson.js";
import { testCaseDesignExcelFilename } from "../services/file/parseTestCaseDesignJson.js";
import { contentDispositionAttachment } from "../services/file/contentDisposition.js";
import { exportExcelFilenameWithTitle } from "../services/file/exportExcelFilename.js";
import { zipUiTestScriptsFromAiOut } from "../services/file/zipUiTestScriptsFromAiOut.js";
import { zTaskType, zTaskTypeOptional } from "../validation/taskTypeZod.js";

const listQuery = z.object({
  /** 按主键精确查询单条；有值时忽略其它筛选并只返回该条 */
  pid: z.string().trim().min(1).max(200).optional(),
  task_type: zParentAgentTypeOptional,
  /** 逗号分隔的多个父任务类型，如 `1,2,3`（与 `task_type` 互斥，优先 `task_type`） */
  task_types: z.string().trim().max(50).optional(),
  title: z.string().max(200).optional(),
  /** 精确匹配关联 `tasks.creator`（存在至少一条子任务命中） */
  creator: z.string().trim().min(1).max(200).optional(),
  /** 模糊匹配 `parent_task_params.init.tapdTaskId` */
  tapd_task_id: z.string().max(200).optional(),
  /** 页码，从 1 开始；列表查询时默认 1 */
  page: z.coerce.number().int().min(1).optional(),
  /** 每页条数；列表查询时默认 20，最大 100 */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const aiOutLatestQuery = z.object({
  task_type: zTaskTypeOptional,
  /** 指定 `tasks.id` 时读取 `ai_out/<pid>/<taskType>/<taskId>/`（须同时传 `task_type`） */
  task_id: z.string().trim().min(1).max(200).optional(),
});

/** `ai_out/<pid>/<taskType>/` 下图片等资源（UI 测试截图等） */
const aiOutAssetQuery = z.object({
  task_type: zTaskType,
  path: z.string().trim().min(1).max(1000),
});

/** 打包下载 UI 测试执行产物（`ai_out/<pid>/12/<taskId>/` → zip） */
const uiTestScriptsZipQuery = z.object({
  /** 可选；省略时按最新 UI 测试执行文档所在 task 目录解析 */
  task_id: z.string().trim().min(1).max(200).optional(),
});

const summarizeStoryTitleBody = z.object({
  task_id: z.string().trim().min(1).max(200),
  source_text: z.string().trim().min(1).max(100_000),
});

const upsertParentTaskParamBody = z.object({
  value_json: z.union([z.number(), z.string()]),
  description: z.string().max(2000).optional(),
});

/** 从 `param_key=init` 的 value_json 读取 tapdTaskId */
function parseTapdTaskIdFromInitValueJson(valueJson: string | undefined): string | undefined {
  if (!valueJson?.trim()) return undefined;
  try {
    const o = JSON.parse(valueJson) as { tapdTaskId?: unknown };
    const v = o.tapdTaskId;
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
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
    const taskTypesCsv = q.task_type ? undefined : parseParentAgentTypesCsv(q.task_types);
    if (q.task_types && !q.task_type && taskTypesCsv === undefined) {
      return reply.status(400).send({ error: "invalid task_types" });
    }
    const listFilters = {
      task_type: q.task_type,
      task_types: taskTypesCsv,
      titleContains: q.title?.trim() || undefined,
      creator: q.creator,
      tapdTaskIdContains: q.tapd_task_id?.trim() || undefined,
    };
    const pageSize = q.limit ?? 20;
    const page = q.page ?? 1;
    const total = countParentTasks(db, listFilters);
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    const rows = listParentTasks(db, {
      ...listFilters,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const pids = rows.map((row) => row.pid);
    const statusByPid = listTaskStatusesByPids(db, pids);
    const adoptionRateJsonByPid = listParentTaskParamValueJsonByParentIdsAndKey(
      db,
      pids,
      TEST_CASE_ADOPTION_RATE_PARAM_KEY,
    );
    const initJsonByPid = listParentTaskParamValueJsonByParentIdsAndKey(
      db,
      pids,
      PARENT_PARAM_KEY_INIT,
    );
    const parent_tasks = rows.map((row) => ({
      ...row,
      exec_status: aggregateParentExecStatus(statusByPid.get(row.pid) ?? []),
      case_adoption_rate: parseTestCaseAdoptionRateValueJson(adoptionRateJsonByPid.get(row.pid)),
      tapdTaskId: parseTapdTaskIdFromInitValueJson(initJsonByPid.get(row.pid)),
    }));
    return {
      parent_tasks,
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
    };
  });

  /** 列出 `ai_out/<pid>/` 下存在 markdown 的 taskType 目录 */
  app.get("/api/parent-tasks/:pid/ai-out/task-types", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    if (!getParentTask(db, pid)) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    try {
      return { pid, task_types: listAiOutMarkdownTaskTypes(pid) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("invalid pid") || msg.includes("path outside")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "list ai_out task types failed");
      return reply.status(500).send({ error: "list ai_out task types failed" });
    }
  });

  /** 业务 Agent：头脑风暴故事列表 + 解析 design.md 澄清摘要（供 Wiki 故事列表点选） */
  app.get("/api/parent-tasks/:pid/brainstorm-stories", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    if (!getParentTask(db, pid)) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    try {
      const tasks = listTasksByPid(db, pid);
      const stories = listBrainstormStoriesForPid(pid, tasks);
      return { pid, stories };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("invalid pid") || msg.includes("path outside")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "list brainstorm stories failed");
      return reply.status(500).send({ error: "list brainstorm stories failed" });
    }
  });

  /** 头脑风暴故事：基于需求文本 AI 汇总标题（供页面打开时异步预填） */
  app.post("/api/parent-tasks/:pid/brainstorm-stories/summarize-title", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    if (!getParentTask(db, pid)) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    const parsedBody = summarizeStoryTitleBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }
    try {
      const summaryTitle = await summarizeTitleFromSourceText(db, parsedBody.data.source_text);
      return reply.send({
        pid,
        task_id: parsedBody.data.task_id,
        summary_title: summaryTitle,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("sourceText 为空")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "summarize brainstorm story title failed");
      return reply.status(500).send({ error: msg });
    }
  });

  /** 读取 `ai_out/<pid>/<taskType>/[<taskId>/]` 下可预览文档（供预览） */
  app.get("/api/parent-tasks/:pid/ai-out/latest", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    const parsed = aiOutLatestQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    if (parsed.data.task_id && parsed.data.task_type === undefined) {
      return reply.status(400).send({ error: "task_type is required when task_id is provided" });
    }
    if (!getParentTask(db, pid)) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    try {
      const doc = parsed.data.task_id
        ? readAiOutMarkdownByTaskId(pid, parsed.data.task_type!, parsed.data.task_id)
        : readLatestAiOutMarkdown(pid, parsed.data.task_type);
      if (!doc) {
        return reply.status(404).send({ error: "no previewable document found in ai_out" });
      }
      return doc;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("invalid pid") || msg.includes("path outside")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "read ai_out latest markdown failed");
      return reply.status(500).send({ error: "read ai_out document failed" });
    }
  });

  /** 读取 `ai_out/<pid>/<taskType>/` 下图片资源（如 UI 测试 `ui_test_screenshots/`） */
  app.get("/api/parent-tasks/:pid/ai-out/asset", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    const parsed = aiOutAssetQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    if (!getParentTask(db, pid)) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    try {
      const asset = readAiOutAsset(pid, parsed.data.task_type, parsed.data.path);
      if (!asset) {
        return reply.status(404).send({ error: "asset not found" });
      }
      return reply
        .header("Content-Type", asset.mime)
        .header("Cache-Control", "private, max-age=3600")
        .send(asset.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "read ai_out asset failed";
      if (msg.includes("invalid") || msg.includes("path outside")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "read ai_out asset failed");
      return reply.status(500).send({ error: "read ai_out asset failed" });
    }
  });

  /** 打包下载 UI 测试执行产物：`ai_out/<pid>/12/<taskId>/` → zip（排除 node_modules 等） */
  app.get("/api/parent-tasks/:pid/ai-out/ui-test-scripts-zip", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    const parsed = uiTestScriptsZipQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    if (!getParentTask(db, pid)) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    try {
      const zipped = await zipUiTestScriptsFromAiOut(pid, parsed.data.task_id);
      if (!zipped) {
        return reply.status(404).send({
          error: "no ui test execute outputs found in ai_out (expected ai_out/<pid>/12/<taskId>/)",
        });
      }
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", contentDispositionAttachment(zipped.filename));
      return reply.send(zipped.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("invalid") || msg.includes("path outside")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "zip ui test scripts failed");
      return reply.status(500).send({ error: "zip ui test scripts failed" });
    }
  });

  /** 扫描 `ai_out/<pid>/` 下全部符合规范的自动化测试案例 JSON，每文件一 sheet 导出 Excel */
  app.get("/api/parent-tasks/:pid/export-autotest-case-excel", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    const parentTask = getParentTask(db, pid);
    if (!parentTask) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    try {
      const files = findAutotestCaseJsonFilesInAiOut(pid);
      if (files.length === 0) {
        return reply.status(404).send({
          error:
            "no autotest case json found in ai_out (requires data.list[] with scriptCaseVo or title/input/expect)",
        });
      }
      const mdFiles = findAutotestMdFilesInAiOut(pid);
      const buf = await autotestCaseToExcelBuffer(files, mdFiles);
      const filename = exportExcelFilenameWithTitle(
        parentTask.title,
        autotestCaseExcelFilename(pid),
      );
      reply.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      reply.header("Content-Disposition", contentDispositionAttachment(filename));
      return reply.send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("invalid pid") || msg.includes("path outside")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "export autotest case excel failed");
      return reply.status(500).send({ error: "export excel failed" });
    }
  });

  /** 扫描 `ai_out/<pid>/` 下最新符合规范的功能测试用例 JSON，导出 Excel */
  app.get("/api/parent-tasks/:pid/export-func-test-case-excel", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    const parentTask = getParentTask(db, pid);
    if (!parentTask) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    try {
      const found = findLatestTestCaseDesignInAiOut(pid);
      if (!found) {
        return reply.status(404).send({
          error: "no test case design json found in ai_out (requires cases[] with test scenario fields)",
        });
      }
      const buf = await testCaseDesignToExcelBuffer(found.doc);
      const filename = exportExcelFilenameWithTitle(
        parentTask.title,
        testCaseDesignExcelFilename(found.relative_path),
      );
      reply.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      reply.header("Content-Disposition", contentDispositionAttachment(filename));
      return reply.send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("invalid pid") || msg.includes("path outside")) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "export func test case excel failed");
      return reply.status(500).send({ error: "export excel failed" });
    }
  });

  /** 用户可编辑的父任务参数 upsert（如用例采纳率） */
  app.put("/api/parent-tasks/:pid/params/:param_key", async (request, reply) => {
    const pid = String((request.params as { pid?: string }).pid ?? "").trim();
    const paramKey = String((request.params as { param_key?: string }).param_key ?? "").trim();
    if (!pid) {
      return reply.status(400).send({ error: "invalid pid" });
    }
    if (!paramKey) {
      return reply.status(400).send({ error: "invalid param_key" });
    }
    if (!isUserEditableParentParamKey(paramKey)) {
      return reply.status(400).send({ error: `param_key "${paramKey}" is not user-editable` });
    }
    if (!getParentTask(db, pid)) {
      return reply.status(404).send({ error: "parent task not found" });
    }
    const parsed = upsertParentTaskParamBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    let value_json: string;
    try {
      if (paramKey === TEST_CASE_ADOPTION_RATE_PARAM_KEY) {
        value_json = normalizeTestCaseAdoptionRateValue(parsed.data.value_json);
      } else {
        value_json = JSON.stringify(parsed.data.value_json);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "invalid value_json";
      return reply.status(400).send({ error: msg });
    }
    const row = upsertParentTaskParam(db, {
      id: randomUUID(),
      parent_task_id: pid,
      param_key: paramKey,
      value_json,
      description: parsed.data.description ?? "用户设置的用例采纳率（%）",
    });
    return {
      parent_task_param: row,
      case_adoption_rate:
        paramKey === TEST_CASE_ADOPTION_RATE_PARAM_KEY
          ? parseTestCaseAdoptionRateValueJson(row.value_json)
          : undefined,
    };
  });

  app.post("/api/parent-tasks", async (request, reply) => {
    const parsed = zCreateParentTaskBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const {
      title,
      description,
      task_type,
      gitRepos,
      testEnv,
      provider,
      directDevAfterDesign,
      parallel,
      skipStorySplit,
      storySplitMode,
      useTradeMock,
      pullBranch,
      tapdTaskId,
      creatorRealName,
      app,
      qaVersion,
      qaApiPath,
      scriptId,
      labelIds,
      requirement,
      testScriptRepo,
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
        value_json: normalizeParentTaskParamValueJson(p.value_json),
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
        gitRepos,
        testEnv,
        provider: provider ?? config.TASK_AGENT_PROVIDER,
        directDevAfterDesign,
      parallel,
      skipStorySplit,
      storySplitMode,
      useTradeMock,
        pullBranch,
        tapdTaskId,
        creatorRealName,
        app,
        qaVersion,
        qaApiPath,
        scriptId,
        labelIds,
        requirement,
        testScriptRepo,
        creator,
        extraParams,
      });
      if (isParentTaskTitlePendingAi(createTitle)) {
        const branchHint = gitRepos
          .map((r) => `${r.gitRemoteUrl}@${r.branch_version}`)
          .join("; ");
        const sourceText = buildParentTaskTitleSource({
          requirement,
          description,
          app,
          branch_version: branchHint,
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
