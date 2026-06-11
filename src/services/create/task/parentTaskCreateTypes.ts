import type { CreateParentTaskWithParamsInput, CreateParentTaskWithParamsResult } from "../../../db/parentTask.js";
import type { TaskRow } from "../../../db/workflow.js";

/** 新增父任务时的编排入参（在 {@link CreateParentTaskWithParamsInput} 基础上扩展 workflow） */
export type CreateParentTaskWorkflowInput = CreateParentTaskWithParamsInput & {
  /** 写入 `tasks.creator`（HTTPS 克隆用户名） */
  creator: string;
  /** 写入 `tasks.input_json.app`（QA 应用名称） */
  app?: string;
  /** 写入 `tasks.input_json.qaVersion` */
  qaVersion?: string;
  /** 写入 `tasks.input_json.qaApiPath` */
  qaApiPath?: string;
  /** 写入 `tasks.input_json.scriptId` */
  scriptId?: string;
  /** 写入 `tasks.input_json.labelIds` */
  labelIds?: number[];
  /** 工作流任务需求；默认取父任务 `description` */
  requirement?: string;
  /** wiki_base 分类 ID；写入 `task_type=22` 子任务的 `input_json.testScriptRepo` */
  testScriptRepo?: string;
};

export type CreateParentTaskWorkflowResult = CreateParentTaskWithParamsResult & {
  /** 与父任务 `pid` 关联的任务列表（`tasks.pid` = 父任务 pid） */
  tasks: TaskRow[];
  /** 开发任务（`task_type = 1`），兼容历史字段 */
  task: TaskRow;
};
