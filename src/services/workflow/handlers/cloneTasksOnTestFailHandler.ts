import { updateTask } from "../../../db/workflow.js";
import { TASK_TYPE, type TaskType } from "../../../constants/taskType.js";
import { getGlobalMaxRetryCount } from "../../dbConfig.js";
import { parseTaskOutPassRateFromChangedFiles } from "../../file/parseTaskOutTestResult.js";
import {
  buildTestExecuteRetryFollowUpMessage,
  buildTestReportFollowUpMessage,
  cloneTestExecuteOnExternalDubboBlocked,
  cloneTasksOnTestNotFullyPassed,
  countTestCaseExecuteTasksUnderParent,
} from "../../loop/cloneTasksOnTestNotFullyPassed.js";
import { notifyTestCaseExecuteResult } from "../../notify/testCaseExecuteNotify.js";
import { AppLog } from "../../appLogger.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 测试案例执行：Webhook 通知；未通过时按 dubbo 阻塞 / 代码问题复制重试节点 */
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

    // 先克隆（此时当前任务仍是原 description，新测试任务可继承），再回写报告全文
    const maxRetry = getGlobalMaxRetryCount(ctx.db);
    const testRunCount = countTestCaseExecuteTasksUnderParent(ctx.db, ctx.parentTaskId);
    const canRetry = testRunCount <= maxRetry;
    const useTradeMock = ctx.gitCtx.taskInputJson.useTradeMock === true;

    if (parsed.passRate === 100) {
      // 已通过，不复制
    } else if (parsed.isBlockedByExternalDubbo === true && useTradeMock) {
      // 优先：外部 dubbo 阻塞且任务 useTradeMock=true → 仅复制测试执行
      if (!canRetry) {
        AppLog.logger.info(
          { parentTaskId: ctx.parentTaskId, testRunCount, maxRetry },
          "cloneTasksOnTestFail: max retry count reached, skip dubbo-blocked retry",
        );
      } else {
        cloneTestExecuteOnExternalDubboBlocked(
          ctx.db,
          ctx.parentTaskId,
          ctx.executingTaskId,
        );
      }
    } else {
      if (parsed.isBlockedByExternalDubbo === true) {
        AppLog.logger.info(
          { parentTaskId: ctx.parentTaskId, passRate: parsed.passRate, useTradeMock },
          "cloneTasksOnTestFail: dubbo blocked but useTradeMock not enabled, skip dubbo-only clone",
        );
      }
      maybeCloneOnCodeProblem(ctx, parsed, canRetry, testRunCount, maxRetry);
    }

    // 解析到来源文件：更新当前测试执行任务 description，下次续跑可持久读到报告全文
    const reportContent = parsed.reportContent.trim();
    if (reportContent) {
      updateTask(ctx.db, ctx.executingTaskId, { description: reportContent });
    }
  },
};

type ParsedForClone = {
  passRate: number;
  summary?: string;
  isCodeProblem?: boolean;
  isBlockedByExternalDubbo?: boolean;
};

function maybeCloneOnCodeProblem(
  ctx: ParentTaskChangedFilesContext,
  parsed: ParsedForClone,
  canRetry: boolean,
  testRunCount: number,
  maxRetry: number,
): void {
  if (parsed.isCodeProblem !== true) {
    AppLog.logger.info(
      {
        parentTaskId: ctx.parentTaskId,
        passRate: parsed.passRate,
        isCodeProblem: parsed.isCodeProblem,
        isBlockedByExternalDubbo: parsed.isBlockedByExternalDubbo,
      },
      "cloneTasksOnTestFail: not marked as code problem, skip clone",
    );
    return;
  }
  if (!parsed.summary?.trim()) {
    AppLog.logger.info(
      {
        parentTaskId: ctx.parentTaskId,
        passRate: parsed.passRate,
        isCodeProblem: parsed.isCodeProblem,
      },
      "cloneTasksOnTestFail: test summary empty, skip clone",
    );
    return;
  }
  if (!canRetry) {
    AppLog.logger.info(
      { parentTaskId: ctx.parentTaskId, testRunCount, maxRetry },
      "cloneTasksOnTestFail: max retry count reached, skip retry",
    );
    return;
  }
  const summary = parsed.summary;
  const devFollowUpMessage = buildTestReportFollowUpMessage(parsed.passRate, summary);
  const testFollowUpMessage = buildTestExecuteRetryFollowUpMessage(parsed.passRate, summary);
  cloneTasksOnTestNotFullyPassed(
    ctx.db,
    ctx.parentTaskId,
    ctx.executingTaskId,
    devFollowUpMessage,
    testFollowUpMessage,
  );
}
