import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { getGlobalMaxRetryCount } from "../../dbConfig.js";
import { parseTaskOutPassRateFromChangedFiles } from "../../file/parseTaskOutTestResult.js";
import {
  buildTestReportDescription,
  cloneTasksOnTestNotFullyPassed,
  countTestCaseExecuteTasksUnderParent,
  notifyTestCaseExecuteFullyPassed,
} from "../../loop/cloneTasksOnTestNotFullyPassed.js";
import { AppLog } from "../../appLogger.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 测试案例执行：100% 时 Webhook 通知；未达 100% 时复制新增开发/测试任务 */
export const cloneTasksOnTestFailHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return taskType === TASK_TYPE.TestCaseExecute;
  },

  async handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const parsed = parseTaskOutPassRateFromChangedFiles(ctx.taskRepoCwd, ctx.relativePaths);
    if (!parsed) return;

    if (parsed.passRate === 100) {
      await notifyTestCaseExecuteFullyPassed(
        ctx.db,
        ctx.parentTaskId,
        ctx.executingTaskId,
        ctx.gitCtx.creator,
        parsed.passRate,
        parsed.summary,
      );
      return;
    }

    const maxRetry = getGlobalMaxRetryCount(ctx.db);
    const testRunCount = countTestCaseExecuteTasksUnderParent(ctx.db, ctx.parentTaskId);
    if (testRunCount > maxRetry) {
      AppLog.logger.info(
        { parentTaskId: ctx.parentTaskId, testRunCount, maxRetry },
        "cloneTasksOnTestFail: max retry count reached, skip retry",
      );
      return Promise.resolve();
    }

    const reportDescription = buildTestReportDescription(parsed.passRate, parsed.summary);
    cloneTasksOnTestNotFullyPassed(
      ctx.db,
      ctx.parentTaskId,
      ctx.executingTaskId,
      reportDescription,
    );
    return Promise.resolve();
  },
};
