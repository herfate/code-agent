import type { DatabaseSync } from "node:sqlite";
import { TASK_TYPE, getTask, listTasksByPid, type TaskRow } from "../../db/workflow.js";
import type { JenkinsPipelineNode } from "../tools/devOpsDeployClient.js";
import { AppLog } from "../appLogger.js";
import { cloneTaskAsPending } from "./cloneTasksOnTestNotFullyPassed.js";

/** 同父任务下已存在的测试环境发布结果任务数（含重试克隆） */
export function countTestEnvDeployResultTasksUnderParent(db: DatabaseSync, parentTaskId: string): number {
  return listTasksByPid(db, parentTaskId).filter((t) => t.task_type === TASK_TYPE.TestEnvDeployResult)
    .length;
}

/** Jenkins 流水线 FAILURE 节点写入开发任务 description 的文本 */
export function buildTestEnvDeployFailureDescription(node: JenkinsPipelineNode): string {
  const name = node.displayName?.trim() || node.id || "unknown";
  const lines = [
    `测试环境 Jenkins 流水线节点失败：${name}（判定为部署/构建问题，需修复后重试）`,
    `节点 id：${node.id ?? "?"}`,
    `结果：${node.result ?? "FAILURE"}`,
  ];
  if (node.startTime) lines.push(`开始时间：${node.startTime}`);
  if (node.type) lines.push(`节点类型：${node.type}`);
  return lines.join("\n");
}

export type CloneTasksOnTestEnvDeployFailedResult = {
  devTask: TaskRow;
  testEnvDeployTask: TaskRow;
  codeReviewTask: TaskRow;
  testEnvDeployResultTask: TaskRow;
};

/**
 * 测试环境发布结果发现 FAILURE：复制新增开发（description 为报告）、测试环境发布、Code Review、发布结果。
 * 顺序与编排一致：开发 → 测试环境发布 → Code Review → 测试环境发布结果。
 */
export function cloneTasksOnTestEnvDeployFailed(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskId: string,
  reportDescription: string,
): CloneTasksOnTestEnvDeployFailedResult | null {
  const executing = getTask(db, executingTaskId);
  if (!executing || executing.pid !== parentTaskId) {
    AppLog.logger.warn(
      { parentTaskId, executingTaskId },
      "cloneTasksOnTestEnvDeployFailed: executing task not found",
    );
    return null;
  }
  if (executing.task_type !== TASK_TYPE.TestEnvDeployResult) {
    return null;
  }

  const tasks = listTasksByPid(db, parentTaskId);
  const sourceDev = [...tasks].reverse().find((t) => t.task_type === TASK_TYPE.Dev);
  const sourceDeploy = [...tasks].reverse().find((t) => t.task_type === TASK_TYPE.TestEnvDeploy);
  const sourceCodeReview = [...tasks].reverse().find((t) => t.task_type === TASK_TYPE.CodeReview);
  if (!sourceDev) {
    AppLog.logger.warn({ parentTaskId }, "cloneTasksOnTestEnvDeployFailed: no dev task under parent");
    return null;
  }
  if (!sourceDeploy) {
    AppLog.logger.warn(
      { parentTaskId },
      "cloneTasksOnTestEnvDeployFailed: no test env deploy task under parent",
    );
    return null;
  }
  if (!sourceCodeReview) {
    AppLog.logger.warn({ parentTaskId }, "cloneTasksOnTestEnvDeployFailed: no code review task under parent");
    return null;
  }

  const devTask = cloneTaskAsPending(db, sourceDev, {
    description: reportDescription,
    created_at: executing.created_at + 1,
  });
  const testEnvDeployTask = cloneTaskAsPending(db, sourceDeploy, {
    description: sourceDeploy.description,
    created_at: executing.created_at + 2,
  });
  const codeReviewTask = cloneTaskAsPending(db, sourceCodeReview, {
    description: sourceCodeReview.description,
    created_at: executing.created_at + 3,
  });
  const testEnvDeployResultTask = cloneTaskAsPending(db, executing, {
    description: executing.description,
    created_at: executing.created_at + 4,
  });

  AppLog.logger.info(
    {
      parentTaskId,
      sourceDevTaskId: sourceDev.id,
      sourceDeployTaskId: sourceDeploy.id,
      sourceCodeReviewTaskId: sourceCodeReview.id,
      sourceDeployResultTaskId: executing.id,
      newDevTaskId: devTask.id,
      newDeployTaskId: testEnvDeployTask.id,
      newCodeReviewTaskId: codeReviewTask.id,
      newDeployResultTaskId: testEnvDeployResultTask.id,
    },
    "cloneTasksOnTestEnvDeployFailed: cloned dev, deploy, code review and deploy result tasks",
  );

  return { devTask, testEnvDeployTask, codeReviewTask, testEnvDeployResultTask };
}
