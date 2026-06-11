import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { parseAiStorySplitFragmentsFromChangedFiles } from "../../file/parseTaskOutAiStorySplitResult.js";
import { cloneBrainstormTasksFromAiStorySplit } from "../../loop/cloneBrainstormTasksFromAiStorySplit.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** AI 拆分故事：按 story_N.md 正文复制头脑风暴任务 */
export const cloneBrainstormTasksOnAiStorySplitHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return taskType === TASK_TYPE.AiStorySplit;
  },

  handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const fragments = parseAiStorySplitFragmentsFromChangedFiles(ctx.taskRepoCwd, ctx.relativePaths);
    if (fragments.length === 0) return Promise.resolve();

    cloneBrainstormTasksFromAiStorySplit(
      ctx.db,
      ctx.parentTaskId,
      ctx.executingTaskId,
      fragments,
    );
    return Promise.resolve();
  },
};
