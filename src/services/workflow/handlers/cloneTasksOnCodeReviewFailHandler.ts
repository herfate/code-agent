import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { getGlobalMaxRetryCount } from "../../dbConfig.js";
import { parseCodeReviewGateFromChangedFiles } from "../../file/parseTaskOutCodeReviewResult.js";
import {
  buildCodeReviewReportDescription,
  cloneTasksOnCodeReviewNotPassed,
  countCodeReviewTasksUnderParent,
} from "../../loop/cloneTasksOnCodeReviewNotPassed.js";
import { AppLog } from "../../appLogger.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** Code Review：未通过合并门禁时复制新增开发 / 测试环境发布 / Code Review 任务 */
export const cloneTasksOnCodeReviewFailHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return taskType === TASK_TYPE.CodeReview;
  },

  async handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const parsed = parseCodeReviewGateFromChangedFiles(ctx.taskRepoCwd, ctx.relativePaths);
    if (!parsed) return;

    if (parsed.mergeAllowed) {
      return;
    }

    const maxRetry = getGlobalMaxRetryCount(ctx.db);
    const codeReviewRunCount = countCodeReviewTasksUnderParent(ctx.db, ctx.parentTaskId);
    if (codeReviewRunCount > maxRetry) {
      AppLog.logger.info(
        { parentTaskId: ctx.parentTaskId, codeReviewRunCount, maxRetry },
        "cloneTasksOnCodeReviewFail: max retry count reached, skip retry",
      );
      return;
    }

    const reportDescription = buildCodeReviewReportDescription(parsed);
    cloneTasksOnCodeReviewNotPassed(
      ctx.db,
      ctx.parentTaskId,
      ctx.executingTaskId,
      reportDescription,
    );
    return;
  },
};
