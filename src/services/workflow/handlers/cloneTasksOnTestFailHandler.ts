import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { getGlobalMaxRetryCount } from "../../dbConfig.js";
import { parseTaskOutPassRateFromChangedFiles } from "../../file/parseTaskOutTestResult.js";
import {
  buildTestReportDescription,
  cloneTasksOnTestNotFullyPassed,
  countTestCaseExecuteTasksUnderParent,
} from "../../loop/cloneTasksOnTestNotFullyPassed.js";
import { notifyTestCaseExecuteResult } from "../../notify/testCaseExecuteNotify.js";
import { AppLog } from "../../appLogger.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 测试案例执行：Webhook 通知；输出判定为代码问题时复制新增开发/测试任务 */
export const cloneTasksOnTestFailHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return taskType === TASK_TYPE.TestCaseExecute;
  },

  async handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const parsed = parseTaskOutPassRateFromChangedFiles(ctx.taskRepoCwd, ctx.relativePaths);
    if (!parsed) return;

    await notifyTestCaseExecuteResult(
      ctx.db,
      ctx.parentTaskId,
      ctx.executingTaskId,
      ctx.gitCtx.creator,
      parsed.passRate,
      parsed.summary,
    );

    if (parsed.isCodeProblem !== true) {
      AppLog.logger.info(
        {
          parentTaskId: ctx.parentTaskId,
          passRate: parsed.passRate,
          isCodeProblem: parsed.isCodeProblem,
        },
        "cloneTasksOnTestFail: not marked as code problem, skip clone",
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
