import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { getGlobalMaxCodeReviewRunCount } from "../../dbConfig.js";
import { parseCodeReviewGateFromChangedFiles } from "../../file/parseTaskOutCodeReviewResult.js";
import {
  buildCodeReviewReportFollowUpMessage,
  buildCodeReviewRetryFollowUpMessage,
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

    const maxRunCount = getGlobalMaxCodeReviewRunCount(ctx.db);
    const codeReviewRunCount = countCodeReviewTasksUnderParent(ctx.db, ctx.parentTaskId);
    if (codeReviewRunCount >= maxRunCount) {
      AppLog.logger.info(
        { parentTaskId: ctx.parentTaskId, codeReviewRunCount, maxRunCount },
        "cloneTasksOnCodeReviewFail: max code review run count reached, skip retry",
      );
      return;
    }

    const devFollowUpMessage = buildCodeReviewReportFollowUpMessage(parsed);
    const codeReviewFollowUpMessage = buildCodeReviewRetryFollowUpMessage(parsed);
    cloneTasksOnCodeReviewNotPassed(
      ctx.db,
      ctx.parentTaskId,
      ctx.executingTaskId,
      devFollowUpMessage,
      codeReviewFollowUpMessage,
    );
    return;
  },
};
