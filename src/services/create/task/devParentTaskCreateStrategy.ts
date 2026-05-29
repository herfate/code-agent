import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ParentTaskInitJson } from "../../../db/parentTask.js";
import type { CreateParentTaskWithParamsResult } from "../../../db/parentTask.js";
import { PARENT_AGENT_TYPE, type ParentAgentType } from "../../../constants/parentAgentType.js";
import { TASK_TYPE, taskTypeLabel, type TaskType } from "../../../constants/taskType.js";
import { createTask, type TaskRow } from "../../../db/workflow.js";
import type { CreateParentTaskWorkflowInput } from "./parentTaskCreateTypes.js";

/** 开发任务编排上下文（父任务与 init 参数已写入库） */
export type DevParentTaskWorkflowContext = {
  pid: string;
  input: CreateParentTaskWorkflowInput;
  parentPart: CreateParentTaskWithParamsResult;
  requirement: string;
  init: ParentTaskInitJson;
  taskType: ParentAgentType;
};

/** 开发自测父任务编排（含测试预分析、测试案例等完整流水线） */
export const DEV_PARENT_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.Design,
  TASK_TYPE.TestPreAnalysis,
  TASK_TYPE.Dev,
  TASK_TYPE.TestEnvDeploy,
  TASK_TYPE.CodeReview,
  TASK_TYPE.TestEnvDeployResult,
  TASK_TYPE.TestCaseDesign,
  TASK_TYPE.TestDataAnalysis,
  TASK_TYPE.TestCaseExecute,
] as const;

/** 开发自Review父任务编排（设计 → 开发 → 测试环境发布 → Code Review，无测试流水线） */
export const DEV_REVIEW_NO_TEST_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.Design,
  TASK_TYPE.Dev,
  TASK_TYPE.TestEnvDeploy,
  TASK_TYPE.CodeReview,
  TASK_TYPE.TestEnvDeployResult,
] as const;

/** 功能测试父任务编排（测试环境发布 → 测试预分析 → 测试案例设计 → 测试数据分析 → 测试案例执行） */
export const FUNC_TEST_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.TestEnvDeploy,
  TASK_TYPE.TestPreAnalysis,
  TASK_TYPE.TestCaseDesign,
  TASK_TYPE.TestDataAnalysis,
  TASK_TYPE.TestCaseExecute,
] as const;

/** 业务 Agent 父任务编排：拆分故事 → 头脑风暴 */
export const BIZ_AGENT_WORKFLOW_TASK_TYPES = [TASK_TYPE.StorySplit, TASK_TYPE.Brainstorm] as const;

export type DevParentTaskWorkflowResult = {
  /** 设计 → 开发 → 测试环境发布 → … → 测试数据分析 → 测试案例执行 */
  tasks: TaskRow[];
  /** 开发任务（`task_type = 1`），与历史 API 字段 `task` 兼容 */
  task: TaskRow;
};

function buildTaskInputJson(opts: {
  app?: string;
  gitRepos: ParentTaskInitJson["gitRepos"];
  testEnv: string;
  requirement: string;
}): string {
  const payload: Record<string, unknown> = {
    gitRepos: opts.gitRepos,
    requirement: opts.requirement,
  };
  const app = opts.app?.trim();
  if (app) payload.app = app;
  const testEnv = opts.testEnv?.trim();
  if (testEnv) payload.testEnv = testEnv;
  return JSON.stringify(payload);
}

function resolveBaseTitle(
  input: CreateParentTaskWorkflowInput,
  parentPart: CreateParentTaskWithParamsResult,
  pid: string,
): string {
  return input.title?.trim() || parentPart.parent_task.title || pid;
}

function createWorkflowTasks(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
  workflowTypes: readonly TaskType[],
): DevParentTaskWorkflowResult {
  const { pid, input, parentPart, requirement, init } = ctx;
  const baseTitle = resolveBaseTitle(input, parentPart, pid);
  const inputJson = buildTaskInputJson({
    app: input.app,
    gitRepos: init.gitRepos,
    testEnv: init.testEnv,
    requirement,
  });
  const metaJson = JSON.stringify({ parentTaskPid: pid });

  const baseCreatedAt = Date.now();
  const tasks = workflowTypes.map((workflowTaskType, index) => {
    const at = baseCreatedAt + index * 100;
    return createTask(db, {
      id: randomUUID(),
      title: `${baseTitle} - ${taskTypeLabel(workflowTaskType)}`,
      description: requirement,
      task_type: workflowTaskType,
      creator: input.creator,
      pid,
      input_json: inputJson,
      meta_json: metaJson,
      created_at: at,
      updated_at: at,
    });
  });
  const task = tasks.find((t) => t.task_type === TASK_TYPE.Dev) ?? tasks[0]!;
  return { tasks, task };
}

/** 开发自测父任务（`parent_task.task_type = 1`）：按流水线创建设计、开发、测试等 `tasks` */
export function runDevParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  return createWorkflowTasks(db, ctx, DEV_PARENT_WORKFLOW_TASK_TYPES);
}

/** 开发自Review父任务（`parent_task.task_type = 2`）：设计 → 开发 → 测试环境发布 → Code Review */
export function runDevReviewNoTestParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  return createWorkflowTasks(db, ctx, DEV_REVIEW_NO_TEST_WORKFLOW_TASK_TYPES);
}

/** 功能测试父任务（`parent_task.task_type = 3`）：测试环境发布 → 测试预分析 → 测试案例设计 → 测试数据分析 → 测试案例执行 */
export function runFuncTestParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  return createWorkflowTasks(db, ctx, FUNC_TEST_WORKFLOW_TASK_TYPES);
}

/** 开发自测父任务 Agent 类型（供编排层路由） */
export const DEV_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.DevSelfTest;

/** 开发自Review父任务 Agent 类型（供编排层路由） */
export const DEV_REVIEW_NO_TEST_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.DevReviewNoTest;

/** 功能测试父任务 Agent 类型（供编排层路由） */
export const FUNC_TEST_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.FuncTest;

/** 业务 Agent 父任务（`parent_task.task_type = 4`）：拆分故事 → 头脑风暴 */
export function runBizParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  return createWorkflowTasks(db, ctx, BIZ_AGENT_WORKFLOW_TASK_TYPES);
}

/** 业务 Agent 父任务类型（供编排层路由） */
export const BIZ_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.BizAgent;
