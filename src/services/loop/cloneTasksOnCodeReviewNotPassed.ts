import type { DatabaseSync } from "node:sqlite";
import { TASK_TYPE, getTask, listTasksByPid, type TaskRow } from "../../db/workflow.js";
import type { ParsedCodeReviewGate } from "../file/parseTaskOutCodeReviewResult.js";
import { AppLog } from "../appLogger.js";
import { pushFollowUpMessageToTaskMeta } from "../taskFollowUpPrompt.js";
import { cloneTaskAsPending } from "./cloneTasksOnTestNotFullyPassed.js";

/** 同父任务下已存在的 Code Review 任务数（含重试克隆） */
export function countCodeReviewTasksUnderParent(db: DatabaseSync, parentTaskId: string): number {
  return listTasksByPid(db, parentTaskId).filter((t) => t.task_type === TASK_TYPE.CodeReview)
    .length;
}

/** Code Review 未通过时追加到开发任务 followUpMessages 的文本 */
export function buildCodeReviewReportFollowUpMessage(gate: ParsedCodeReviewGate): string {
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
  testEnvDeployTask: TaskRow | null;
  codeReviewTask: TaskRow;
};

/**
 * Code Review 未通过：复制新增同父任务下开发（followUpMessages 追加报告）、测试环境发布（若有）、Code Review。
 * 顺序与编排一致：开发 → [测试环境发布] → Code Review。
 */
export function cloneTasksOnCodeReviewNotPassed(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskId: string,
  followUpMessage: string,
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

  // 保留原 description，审查报告追加到 followUpMessages（续跑时作为 Agent 提示词）
  const devMetaJson = pushFollowUpMessageToTaskMeta(sourceDev.meta_json, followUpMessage);
  const devTask = cloneTaskAsPending(db, sourceDev, {
    description: sourceDev.description,
    meta_json: devMetaJson,
    created_at: executing.created_at + 1,
  });
  let testEnvDeployTask: TaskRow | null = null;
  let codeReviewOffset = 2;
  if (sourceDeploy) {
    testEnvDeployTask = cloneTaskAsPending(db, sourceDeploy, {
      description: sourceDeploy.description,
      created_at: executing.created_at + 2,
    });
    codeReviewOffset = 3;
  }
  const codeReviewTask = cloneTaskAsPending(db, executing, {
    description: executing.description,
    created_at: executing.created_at + codeReviewOffset,
  });

  AppLog.logger.info(
    {
      parentTaskId,
      sourceDevTaskId: sourceDev.id,
      sourceDeployTaskId: sourceDeploy?.id ?? null,
      sourceCodeReviewTaskId: executing.id,
      newDevTaskId: devTask.id,
      newDeployTaskId: testEnvDeployTask?.id ?? null,
      newCodeReviewTaskId: codeReviewTask.id,
    },
    sourceDeploy
      ? "cloneTasksOnCodeReviewNotPassed: cloned dev, deploy and code review tasks"
      : "cloneTasksOnCodeReviewNotPassed: cloned dev and code review tasks (no deploy node)",
  );

  return { devTask, testEnvDeployTask, codeReviewTask };
}
