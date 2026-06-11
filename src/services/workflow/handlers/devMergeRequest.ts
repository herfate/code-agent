import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { tryCreateDevMergeRequest } from "../../mergeRequest/devMR.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 开发任务：提交变更并创建 GitLab MR */
export const devMergeRequestHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return taskType === TASK_TYPE.Dev;
  },

  async handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    await tryCreateDevMergeRequest({
      db: ctx.db,
      taskInputJson: ctx.gitCtx.taskInputJson,
      creator: ctx.gitCtx.creator,
      taskRepoCwd: ctx.taskRepoCwd,
      parentTaskId: ctx.parentTaskId,
      executingTaskId: ctx.executingTaskId,
      executingTaskType: ctx.taskType,
      relativePaths: ctx.relativePaths,
    });
  },
};
