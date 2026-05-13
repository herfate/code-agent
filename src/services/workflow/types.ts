import type { DatabaseSync } from "node:sqlite";
import type { TaskType } from "../../constants/taskType.js";
import type { TaskInputJson } from "../../db/taskInputJson.js";

/** 父任务变更文件处理链的共享上下文 */
export type ParentTaskChangedFilesContext = {
  db: DatabaseSync;
  parentTaskId: string;
  /** 当前完成 Agent 运行的子任务 id */
  executingTaskId: string;
  taskType: TaskType;
  taskRepoCwd: string;
  relativePaths: string[];
  gitCtx: { taskInputJson: TaskInputJson; creator: string | null };
};

/** 按 `task_type` 决定是否参与处理的责任链节点 */
export type ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean;
  handle(ctx: ParentTaskChangedFilesContext): Promise<void>;
};
