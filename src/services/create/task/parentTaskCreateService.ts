import type { DatabaseSync } from "node:sqlite";
import { PARENT_PARAM_KEY_INIT } from "../../../constants/commonKey.js";
import {
  createParentTaskWithParamsCore,
  parseParentTaskInitJson,
  type CreateParentTaskWithParamsResult,
} from "../../../db/parentTask.js";
import { PARENT_AGENT_TYPE } from "../../../constants/parentAgentType.js";
import type { ParentAgentType } from "../../../constants/parentAgentType.js";
import type { TaskRow } from "../../../db/workflow.js";
import { DEV_PARENT_TASK_TYPE, runDevParentTaskWorkflow } from "./devParentTaskCreateStrategy.js";
import type {
  CreateParentTaskWorkflowInput,
  CreateParentTaskWorkflowResult,
} from "./parentTaskCreateTypes.js";

export type { CreateParentTaskWorkflowInput, CreateParentTaskWorkflowResult } from "./parentTaskCreateTypes.js";

function resolveRequirement(
  input: CreateParentTaskWorkflowInput,
  parentPart: CreateParentTaskWithParamsResult,
): string {
  return (
    input.requirement?.trim() ||
    input.description?.trim() ||
    parentPart.parent_task.description ||
    ""
  );
}

function runWorkflowByTaskType(
  db: DatabaseSync,
  taskType: ParentAgentType,
  ctx: {
    pid: string;
    input: CreateParentTaskWorkflowInput;
    parentPart: CreateParentTaskWithParamsResult;
    requirement: string;
    init: ReturnType<typeof parseParentTaskInitJson>;
  },
): { tasks: TaskRow[]; task: TaskRow } {
  switch (taskType) {
    case DEV_PARENT_TASK_TYPE:
      return runDevParentTaskWorkflow(db, { ...ctx, taskType });
    default:
      throw new Error(`unsupported parent task_type: ${taskType}`);
  }
}

/**
 * 新增父任务：写入 `parent_task` / `parent_task_params`，
 * 按 `task_type` 选择策略创建关联 `tasks`
 */
export function createParentTaskWorkflow(
  db: DatabaseSync,
  input: CreateParentTaskWorkflowInput,
): CreateParentTaskWorkflowResult {
  const creator = input.creator.trim();
  if (!creator) {
    throw new Error("creator is required");
  }
  const workflowInput: CreateParentTaskWorkflowInput = { ...input, creator };
  db.exec("BEGIN");
  try {
    const parentPart = createParentTaskWithParamsCore(db, workflowInput);
    const initRow = parentPart.parent_task_params.find((p) => p.param_key === PARENT_PARAM_KEY_INIT);
    const init = parseParentTaskInitJson(initRow?.value_json);
    const requirement = resolveRequirement(workflowInput, parentPart);
    const taskType =
      workflowInput.task_type ?? parentPart.parent_task.task_type ?? PARENT_AGENT_TYPE.DevSelfTest;
    const { tasks, task } = runWorkflowByTaskType(db, taskType, {
      pid: workflowInput.pid,
      input: workflowInput,
      parentPart,
      requirement,
      init,
    });
    db.exec("COMMIT");
    return { ...parentPart, tasks, task };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
