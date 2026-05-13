import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ParentTaskInitJson } from "../../../db/parentTask.js";
import type { CreateParentTaskWithParamsResult } from "../../../db/parentTask.js";
import { PARENT_AGENT_TYPE, type ParentAgentType } from "../../../constants/parentAgentType.js";
import { TASK_TYPE, taskTypeLabel } from "../../../constants/taskType.js";
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

/** 开发父任务编排下固定创建的 workflow 任务（含末尾工具任务：测试环境发布） */
export const DEV_PARENT_WORKFLOW_TASK_TYPES = [
  TASK_TYPE.Design,
  TASK_TYPE.TestPreAnalysis,
  TASK_TYPE.Dev,
  TASK_TYPE.TestEnvDeploy,
  TASK_TYPE.TestCaseDesign,
  TASK_TYPE.TestDataAnalysis,
] as const;

export type DevParentTaskWorkflowResult = {
  /** 设计 → 开发 → a-测试环境发布 → 测试数据分析等等 */
  tasks: TaskRow[];
  /** 开发任务（`task_type = 1`），与历史 API 字段 `task` 兼容 */
  task: TaskRow;
};

function buildTaskInputJson(opts: {
  app?: string;
  branch_version: string;
  gitRemoteUrl: string;
  testEnv: string;
  requirement: string;
}): string {
  const payload: Record<string, string> = {
    branch_version: opts.branch_version,
    gitRemoteUrl: opts.gitRemoteUrl,
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

/** 开发自测父任务（`parent_task.task_type = 1`）：按流水线创建设计、开发、测试等 `tasks` */
export function runDevParentTaskWorkflow(
  db: DatabaseSync,
  ctx: DevParentTaskWorkflowContext,
): DevParentTaskWorkflowResult {
  const { pid, input, parentPart, requirement, init } = ctx;
  const baseTitle = resolveBaseTitle(input, parentPart, pid);
  const inputJson = buildTaskInputJson({
    app: input.app,
    branch_version: init.branch_version,
    gitRemoteUrl: init.gitRemoteUrl,
    testEnv: init.testEnv,
    requirement,
  });
  const metaJson = JSON.stringify({ parentTaskPid: pid });

  const baseCreatedAt = Date.now();
  const tasks = DEV_PARENT_WORKFLOW_TASK_TYPES.map((workflowTaskType, index) => {
    const at = baseCreatedAt + index;
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
  const task = tasks.find((t) => t.task_type === TASK_TYPE.Dev)!;
  return { tasks, task };
}

/** 开发自测父任务 Agent 类型（供编排层路由） */
export const DEV_PARENT_TASK_TYPE = PARENT_AGENT_TYPE.DevSelfTest;
