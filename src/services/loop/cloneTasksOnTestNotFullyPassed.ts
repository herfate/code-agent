import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  TASK_STATUS,
  TASK_TYPE,
  createTask,
  getTask,
  listTasksByPid,
  type TaskRow,
  type TaskType,
} from "../../db/workflow.js";
import { AppLog } from "../appLogger.js";

/** 同父任务下已存在的测试案例执行任务数 */
export function countTestCaseExecuteTasksUnderParent(db: DatabaseSync, parentTaskId: string): number {
  return listTasksByPid(db, parentTaskId).filter((t) => t.task_type === TASK_TYPE.TestCaseExecute).length;
}

/** 判定为代码问题时写入开发任务 description 的文本 */
export function buildTestReportDescription(passRate: number, summary?: string): string {
  const lines = [`测试通过率：${passRate}%（判定为代码问题，需修复后重试）`];
  if (summary?.trim()) {
    lines.push("", "测试总结简述：", summary.trim());
  }
  return lines.join("\n");
}

/** 复制源任务为 Pending（保留 thread_id 以便续跑） */
export function cloneTaskAsPending(
  db: DatabaseSync,
  source: TaskRow,
  overrides: { description: string; created_at: number; task_type?: TaskType },
): TaskRow {
  return createTask(db, {
    id: randomUUID(),
    title: source.title,
    description: overrides.description,
    status: TASK_STATUS.Pending,
    task_type: overrides.task_type ?? source.task_type,
    creator: source.creator,
    pid: source.pid,
    thread_id: source.thread_id, // 关联线程,能够拉起继续对话
    input_json: source.input_json,
    meta_json: source.meta_json,
    created_at: overrides.created_at,
    updated_at: overrides.created_at,
  });
}

export type CloneTasksOnTestNotFullyPassedResult = {
  devTask: TaskRow;
  testTask: TaskRow;
};

/**
 * 测试案例执行判定为代码问题：复制新增同父任务下开发、测试环境发布、部署间隔等待与测试执行任务。
 * 参考 {@link saveDescription4TasksUnderParent} 按 `pid` + `task_type` 定位源任务。
 */
export function cloneTasksOnTestNotFullyPassed(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskId: string,
  reportDescription: string,
): CloneTasksOnTestNotFullyPassedResult | null {
  const executing = getTask(db, executingTaskId);
  if (!executing || executing.pid !== parentTaskId) {
    AppLog.logger.warn(
      { parentTaskId, executingTaskId },
      "cloneTasksOnTestNotFullyPassed: executing task not found",
    );
    return null;
  }
  if (executing.task_type !== TASK_TYPE.TestCaseExecute) {
    return null;
  }

  const tasks = listTasksByPid(db, parentTaskId);
  const sourceDev = [...tasks].reverse().find((t) => t.task_type === TASK_TYPE.Dev);
  if (!sourceDev) {
    AppLog.logger.warn({ parentTaskId }, "cloneTasksOnTestNotFullyPassed: no dev task under parent");
    return null;
  }
  const sourceDeploy = [...tasks]
      .reverse()
      .find((t) => t.task_type === TASK_TYPE.TestEnvDeploy);
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
  const deployTask = cloneTaskAsPending(db, sourceDeploy, {
    description: "测试环境发布",
    created_at: executing.created_at + 2,
  });
  const deployWaitTask = cloneTaskAsPending(db, sourceDeploy, {
    description: "部署间隔等待",
    created_at: executing.created_at + 3,
    task_type: TASK_TYPE.DeployWait,
  });
  const deployResultTask = cloneTaskAsPending(db, sourceDeploy, {
    description: "测试环境发布结果",
    created_at: executing.created_at + 4,
    task_type: TASK_TYPE.TestEnvDeployResult,
  });
  const testTask = cloneTaskAsPending(db, executing, {
    description: executing.description,
    created_at: executing.created_at + 5,
  });

  AppLog.logger.info(
    {
      parentTaskId,
      sourceDevTaskId: sourceDev.id,
      sourceTestTaskId: executing.id,
      newDevTaskId: devTask.id,
      newDeployTaskId: deployTask.id,
      newDeployWaitTaskId: deployWaitTask.id,
      newDeployResultTaskId: deployResultTask.id,
      newTestTaskId: testTask.id,
    },
    "cloneTasksOnTestNotFullyPassed: cloned dev, deploy, deploy wait, deploy result and test tasks",
  );

  return { devTask, testTask };
}
