import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ParentTaskInitJson } from "../../../db/parentTask.js";
import type { CreateParentTaskWithParamsResult } from "../../../db/parentTask.js";
import { PARENT_AGENT_TYPE, type ParentAgentType } from "../../../constants/parentAgentType.js";
import { TASK_TYPE, taskTypeLabel, type TaskType } from "../../../constants/taskType.js";
import { createTask, type TaskRow } from "../../../db/workflow.js";
import { filterWorkflowTypesForTestEnv } from "../../workflow/skipTestEnvForDevReview.js";
import type { DevOpsBranchApplyPayload } from "../../tools/devOpsBranchApplyClient.js";
import { buildBranchApplyPayloadFromInit } from "../branchApplyPayloadBuilder.js";
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

/** 功能测试父任务编排（测试环境发布 → 测试预分析 → 测试案例设计 → 测试数据分析 → 测试案例执行 → UI测试执行） */
export const FUNC_TEST_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.TestEnvDeploy,
  TASK_TYPE.TestPreAnalysis,
  TASK_TYPE.TestCaseDesign,
  TASK_TYPE.TestDataAnalysis,
  TASK_TYPE.TestCaseExecute,
  TASK_TYPE.UiTestExecute,
] as const;

/** 业务 Agent 父任务编排：按分隔符拆分故事 → 头脑风暴 */
export const BIZ_AGENT_WORKFLOW_TASK_TYPES = [TASK_TYPE.StorySplit, TASK_TYPE.Brainstorm] as const;

/** 业务 Agent 父任务编排：按 AI 理解拆分故事 → 头脑风暴 */
export const BIZ_AGENT_AI_STORY_SPLIT_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.AiStorySplit,
  TASK_TYPE.Brainstorm,
] as const;

/** 业务 Agent 单故事编排：仅头脑风暴（跳过拆分故事） */
export const BIZ_AGENT_SINGLE_STORY_WORKFLOW_TASK_TYPES = [TASK_TYPE.Brainstorm] as const;

/** 测试案例编排父任务（`parent_task.task_type = 5`）：功能测试用例生成 → 测试脑图分析 */
export const TEST_CASE_ORCHESTRATE_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.FuncTestCaseGen,
  TASK_TYPE.TestMindMapAnalysis,
] as const;

/** 自动化测试父任务（`parent_task.task_type = 6`）：功能测试用例生成 → 自动化用例生成 */
export const AUTO_TEST_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.FuncTestCaseGen,
  TASK_TYPE.AutoTestCaseGen,
] as const;

/** 沉淀记忆父任务（`parent_task.task_type = 7`）：生成业务知识 → 生成代码规范 → 生成测试规范 */
export const PERSIST_MEMORY_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.PersistMemory,
  TASK_TYPE.GenCodeSpec,
  TASK_TYPE.GenTestSpec,
] as const;

export type DevParentTaskWorkflowResult = {
  /** 设计 → 开发 → 测试环境发布 → … → 测试数据分析 → 测试案例执行 */
  tasks: TaskRow[];
  /** 开发任务（`task_type = 1`），与历史 API 字段 `task` 兼容 */
  task: TaskRow;
};

function buildTaskInputJson(opts: {
  app?: string;
  qaVersion?: string;
  qaApiPath?: string;
  scriptId?: string;
  labelIds?: number[];
  gitRepos: ParentTaskInitJson["gitRepos"];
  testEnv: string;
  requirement: string;
  testScriptRepo?: string;
  useTradeMock?: boolean;
  pullBranch?: boolean;
  tapdTaskId?: string;
  /** BranchApply 节点的请求体（仅 task_type=104 任务注入） */
  branchApply?: DevOpsBranchApplyPayload;
}): string {
  const payload: Record<string, unknown> = {
    gitRepos: opts.gitRepos,
    requirement: opts.requirement,
  };
  const app = opts.app?.trim();
  if (app) payload.app = app;
  const qaVersion = opts.qaVersion?.trim();
  if (qaVersion) payload.qaVersion = qaVersion;
  const qaApiPath = opts.qaApiPath?.trim();
  if (qaApiPath) payload.qaApiPath = qaApiPath;
  const scriptId = opts.scriptId?.trim();
  if (scriptId) payload.scriptId = scriptId;
  if (opts.labelIds?.length) payload.labelIds = opts.labelIds;
  const testEnv = opts.testEnv?.trim();
  if (testEnv) payload.testEnv = testEnv;
  const testScriptRepo = opts.testScriptRepo?.trim();
  if (testScriptRepo) payload.testScriptRepo = testScriptRepo;
  if (opts.useTradeMock === true) payload.useTradeMock = true;
  if (opts.pullBranch === true) payload.pullBranch = true;
  if (opts.branchApply) payload.branchApply = opts.branchApply;
  const tapdTaskId = opts.tapdTaskId?.trim();
  if (tapdTaskId) payload.tapdTaskId = tapdTaskId;
  return JSON.stringify(payload);
}

function resolveBaseTitle(
  input: CreateParentTaskWorkflowInput,
  parentPart: CreateParentTaskWithParamsResult,
  pid: string,
): string {
  return input.title?.trim() || parentPart.parent_task.title || pid;
}

/**
 * 勾选拉取分支时，在工作流首位前置 BranchApply 节点。
 * 仅开发自测(1)/开发自review(2)支持；`payload` 为空（未勾选或 payload 不可推导）时不前置。
 */
function prependBranchApplyIfEnabled(
  parentTaskType: ParentAgentType,
  branchApplyPayload: DevOpsBranchApplyPayload | undefined,
  workflowTypes: readonly TaskType[],
): TaskType[] {
  if (!branchApplyPayload) return [...workflowTypes];
  if (
    parentTaskType !== PARENT_AGENT_TYPE.DevSelfTest &&
    parentTaskType !== PARENT_AGENT_TYPE.DevReviewNoTest
  ) {
    return [...workflowTypes];
  }
  return [TASK_TYPE.BranchApply, ...workflowTypes];
}

function createWorkflowTasks(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
  workflowTypes: readonly TaskType[],
): DevParentTaskWorkflowResult {
  const { pid, input, parentPart, requirement, init } = ctx;
  const baseTitle = resolveBaseTitle(input, parentPart, pid);
  const metaJson = JSON.stringify({ parentTaskPid: pid });
  const filteredTypes = filterWorkflowTypesForTestEnv(ctx.taskType, init.testEnv, workflowTypes);
  // 勾选拉取分支时前置 BranchApply 节点；payload 不可推导（gitRepos 为空等）时不前置
  const branchApplyPayload =
    init.pullBranch === true ? buildBranchApplyPayloadFromInit(init, requirement) ?? undefined : undefined;
  const effectiveWorkflowTypes = prependBranchApplyIfEnabled(ctx.taskType, branchApplyPayload, filteredTypes);

  const baseCreatedAt = Date.now();
  const tasks = effectiveWorkflowTypes.map((workflowTaskType, index) => {
    const at = baseCreatedAt + index * 100;
    const inputJson = buildTaskInputJson({
      app: input.app,
      qaVersion: input.qaVersion,
      qaApiPath: input.qaApiPath,
      scriptId: input.scriptId,
      labelIds: input.labelIds,
      gitRepos: init.gitRepos,
      testEnv: init.testEnv,
      requirement,
      useTradeMock: init.useTradeMock,
      pullBranch: init.pullBranch,
      tapdTaskId: init.tapdTaskId,
      branchApply:
        workflowTaskType === TASK_TYPE.BranchApply ? branchApplyPayload : undefined,
      testScriptRepo:
        workflowTaskType === TASK_TYPE.TestMindMapAnalysis
          ? input.testScriptRepo?.trim()
          : undefined,
    });
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

/** 开发自Review父任务（`parent_task.task_type = 2`）：设计 → 开发 → [测试环境发布 → Code Review → 发布结果]（无 testEnv 时不含发布节点） */
export function runDevReviewNoTestParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  return createWorkflowTasks(db, ctx, DEV_REVIEW_NO_TEST_WORKFLOW_TASK_TYPES);
}

/** 功能测试父任务（`parent_task.task_type = 3`）：测试环境发布 → 测试预分析 → 测试案例设计 → 测试数据分析 → 测试案例执行 → UI测试执行 */
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

/** 业务 Agent 父任务（`parent_task.task_type = 4`）：拆分故事 → 头脑风暴；单故事时仅头脑风暴 */
export function runBizParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  let workflowTypes: readonly TaskType[];
  if (ctx.init.skipStorySplit === true) {
    workflowTypes = BIZ_AGENT_SINGLE_STORY_WORKFLOW_TASK_TYPES;
  } else if (ctx.init.storySplitMode === "ai") {
    workflowTypes = BIZ_AGENT_AI_STORY_SPLIT_WORKFLOW_TASK_TYPES;
  } else {
    workflowTypes = BIZ_AGENT_WORKFLOW_TASK_TYPES;
  }
  return createWorkflowTasks(db, ctx, workflowTypes);
}

/** 业务 Agent 父任务类型（供编排层路由） */
export const BIZ_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.BizAgent;

/** 测试案例编排父任务（`parent_task.task_type = 5`）：功能测试用例生成 → 测试脑图分析 */
export function runTestCaseOrchestrateParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  return createWorkflowTasks(db, ctx, TEST_CASE_ORCHESTRATE_WORKFLOW_TASK_TYPES);
}

/** 测试案例编排父任务类型（供编排层路由） */
export const TEST_CASE_ORCHESTRATE_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.TestCaseOrchestrate;

/** 自动化测试父任务（`parent_task.task_type = 6`）：功能测试用例生成 → 自动化用例生成 */
export function runAutoTestParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  return createWorkflowTasks(db, ctx, AUTO_TEST_WORKFLOW_TASK_TYPES);
}

/** 自动化测试父任务类型（供编排层路由） */
export const AUTO_TEST_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.AutoTest;

/** 沉淀记忆父任务（`parent_task.task_type = 7`）：生成业务知识 → 生成代码规范 → 生成测试规范 */
export function runPersistMemoryParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  return createWorkflowTasks(db, ctx, PERSIST_MEMORY_WORKFLOW_TASK_TYPES);
}

/** 沉淀记忆父任务类型（供编排层路由） */
export const PERSIST_MEMORY_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.PersistMemory;
