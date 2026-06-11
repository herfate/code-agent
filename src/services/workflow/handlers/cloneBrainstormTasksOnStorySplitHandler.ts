import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { parseStorySplitMarkerFromChangedFiles } from "../../file/parseTaskOutStorySplitResult.js";
import { cloneBrainstormTasksFromStorySplit } from "../../loop/cloneBrainstormTasksFromStorySplit.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 拆分故事：按输出分隔符切分 description，为含中文分片复制头脑风暴任务 */
export const cloneBrainstormTasksOnStorySplitHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return taskType === TASK_TYPE.StorySplit;
  },

  handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const marker = parseStorySplitMarkerFromChangedFiles(ctx.taskRepoCwd, ctx.relativePaths);
    if (!marker) return Promise.resolve();

    cloneBrainstormTasksFromStorySplit(
      ctx.db,
      ctx.parentTaskId,
      ctx.executingTaskId,
      marker,
    );
    return Promise.resolve();
  },
};
