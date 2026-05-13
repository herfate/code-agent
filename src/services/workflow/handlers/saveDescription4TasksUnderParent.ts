import type { TaskType } from "../../../constants/taskType.js";
import {
  resolveDescriptionTargetTaskType,
  saveDescription4TasksUnderParent,
} from "../../prompt/updateDescription4Task.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 将 ai_out 内容写入同父任务下目标子任务 description（当前仅设计→开发） */
export const saveDescription4TasksUnderParentHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return resolveDescriptionTargetTaskType(taskType) !== null;
  },

  handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    saveDescription4TasksUnderParent(ctx.db, ctx.parentTaskId, ctx.taskType, ctx.relativePaths);
    return Promise.resolve();
  },
};
