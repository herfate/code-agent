import { updateTask } from "../../../db/workflow.js";
import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { getGlobalMaxRetryCount } from "../../dbConfig.js";
import { parseTaskOutPassRateFromChangedFiles } from "../../file/parseTaskOutTestResult.js";
import {
  buildTestExecuteRetryFollowUpMessage,
  buildTestReportFollowUpMessage,
  cloneTasksOnTestNotFullyPassed,
  countTestCaseExecuteTasksUnderParent,
} from "../../loop/cloneTasksOnTestNotFullyPassed.js";
import { notifyTestCaseExecuteResult } from "../../notify/testCaseExecuteNotify.js";
import { AppLog } from "../../appLogger.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 测试案例执行：Webhook 通知；判定为代码问题且测试总结简述非空时复制新增开发/测试任务 */
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

    // 仅当「是否代码问题」为是，且「测试总结简述」非空时才复制节点
    // 先克隆（此时当前任务仍是原 description，新测试任务可继承），再回写报告全文
    if (parsed.isCodeProblem !== true) {
      AppLog.logger.info(
        {
          parentTaskId: ctx.parentTaskId,
          passRate: parsed.passRate,
          isCodeProblem: parsed.isCodeProblem,
        },
        "cloneTasksOnTestFail: not marked as code problem, skip clone",
      );
    } else if (!parsed.summary?.trim()) {
      AppLog.logger.info(
        {
          parentTaskId: ctx.parentTaskId,
          passRate: parsed.passRate,
          isCodeProblem: parsed.isCodeProblem,
        },
        "cloneTasksOnTestFail: test summary empty, skip clone",
      );
    } else {
      const maxRetry = getGlobalMaxRetryCount(ctx.db);
      const testRunCount = countTestCaseExecuteTasksUnderParent(ctx.db, ctx.parentTaskId);
      if (testRunCount > maxRetry) {
        AppLog.logger.info(
          { parentTaskId: ctx.parentTaskId, testRunCount, maxRetry },
          "cloneTasksOnTestFail: max retry count reached, skip retry",
        );
      } else {
        const devFollowUpMessage = buildTestReportFollowUpMessage(
          parsed.passRate,
          parsed.summary,
        );
        const testFollowUpMessage = buildTestExecuteRetryFollowUpMessage(
          parsed.passRate,
          parsed.summary,
        );
        cloneTasksOnTestNotFullyPassed(
          ctx.db,
          ctx.parentTaskId,
          ctx.executingTaskId,
          devFollowUpMessage,
          testFollowUpMessage,
        );
      }
    }

    // 解析到来源文件：更新当前测试执行任务 description，下次续跑可持久读到报告全文
    const reportContent = parsed.reportContent.trim();
    if (reportContent) {
      updateTask(ctx.db, ctx.executingTaskId, { description: reportContent });
    }
  },
};
