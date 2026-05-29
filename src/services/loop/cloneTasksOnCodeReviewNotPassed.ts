import type { DatabaseSync } from "node:sqlite";
import { TASK_TYPE, getTask, listTasksByPid, type TaskRow } from "../../db/workflow.js";
import type { ParsedCodeReviewGate } from "../file/parseTaskOutCodeReviewResult.js";
import { AppLog } from "../appLogger.js";
import { cloneTaskAsPending } from "./cloneTasksOnTestNotFullyPassed.js";

/** 同父任务下已存在的 Code Review 任务数（含重试克隆） */
export function countCodeReviewTasksUnderParent(db: DatabaseSync, parentTaskId: string): number {
  return listTasksByPid(db, parentTaskId).filter((t) => t.task_type === TASK_TYPE.CodeReview)
    .length;
}

/** Code Review 未通过时写入开发任务 description */
export function buildCodeReviewReportDescription(gate: ParsedCodeReviewGate): string {
  const lines = [
    `Code Review 未通过（允许合并：${gate.mergeAllowed ? "是" : "否"}）`,
    `审查结论：${gate.verdictLabel}（${gate.verdict}）`,
    `问题统计：blocker=${gate.counts.blocker}, major=${gate.counts.major}, minor=${gate.counts.minor}`,
  ];
  if (gate.mustFixBeforeMerge.length > 0) {
    lines.push(`合并前必改：${gate.mustFixBeforeMerge.join(", ")}`);
  }
  if (gate.summaryZh) {
    lines.push("", "审查摘要：", gate.summaryZh);
  }
  return lines.join("\n");
}

export type CloneTasksOnCodeReviewNotPassedResult = {
  devTask: TaskRow;
  testEnvDeployTask: TaskRow;
  codeReviewTask: TaskRow;
};

/**
 * Code Review 未通过：复制新增同父任务下开发（description 为报告）、测试环境发布、Code Review。
 * 顺序与编排一致：开发 → 测试环境发布 → Code Review。
 */
export function cloneTasksOnCodeReviewNotPassed(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskId: string,
  reportDescription: string,
): CloneTasksOnCodeReviewNotPassedResult | null {
  const executing = getTask(db, executingTaskId);
  if (!executing || executing.pid !== parentTaskId) {
    AppLog.logger.warn(
      { parentTaskId, executingTaskId },
      "cloneTasksOnCodeReviewNotPassed: executing task not found",
    );
    return null;
  }
  if (executing.task_type !== TASK_TYPE.CodeReview) {
    return null;
  }

  const tasks = listTasksByPid(db, parentTaskId);
  const sourceDev = [...tasks].reverse().find((t) => t.task_type === TASK_TYPE.Dev);
  const sourceDeploy = [...tasks]
    .reverse()
    .find((t) => t.task_type === TASK_TYPE.TestEnvDeploy);
  if (!sourceDev) {
    AppLog.logger.warn({ parentTaskId }, "cloneTasksOnCodeReviewNotPassed: no dev task under parent");
    return null;
  }
  if (!sourceDeploy) {
    AppLog.logger.warn(
      { parentTaskId },
      "cloneTasksOnCodeReviewNotPassed: no test env deploy task under parent",
    );
    return null;
  }

  const devTask = cloneTaskAsPending(db, sourceDev, {
    description: reportDescription,
    created_at: executing.created_at + 1, // 每个任务直接间隔了100,用创建时间控制编排顺序,确保这些任务紧跟在此任务之后
  });
  const testEnvDeployTask = cloneTaskAsPending(db, sourceDeploy, {
    description: sourceDeploy.description,
    created_at: executing.created_at + 2,
  });
  const codeReviewTask = cloneTaskAsPending(db, executing, {
    description: executing.description,
    created_at: executing.created_at + 3,
  });

  AppLog.logger.info(
    {
      parentTaskId,
      sourceDevTaskId: sourceDev.id,
      sourceDeployTaskId: sourceDeploy.id,
      sourceCodeReviewTaskId: executing.id,
      newDevTaskId: devTask.id,
      newDeployTaskId: testEnvDeployTask.id,
      newCodeReviewTaskId: codeReviewTask.id,
    },
    "cloneTasksOnCodeReviewNotPassed: cloned dev, deploy and code review tasks",
  );

  return { devTask, testEnvDeployTask, codeReviewTask };
}
