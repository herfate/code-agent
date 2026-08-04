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
import { pushFollowUpMessageToTaskMeta } from "../taskFollowUpPrompt.js";

/** 同父任务下已存在的测试案例执行任务数 */
export function countTestCaseExecuteTasksUnderParent(db: DatabaseSync, parentTaskId: string): number {
  return listTasksByPid(db, parentTaskId).filter((t) => t.task_type === TASK_TYPE.TestCaseExecute).length;
}

/** 判定为代码问题且有测试总结简述时追加到开发任务 followUpMessages 的文本 */
export function buildTestReportFollowUpMessage(passRate: number, summary: string): string {
  return [
    `测试通过率：${passRate}%（判定为代码问题，需修复报告中的代码问题）`,
    "",
    "测试总结简述：",
    summary.trim(),
  ].join("\n");
}

/** 同上场景追加到测试执行任务 followUpMessages 的文本（提示复测，而非改代码） */
export function buildTestExecuteRetryFollowUpMessage(passRate: number, summary: string): string {
  return [
    `上次测试通过率：${passRate}%（代码问题已交开发修复并重新发布，请针对失败案例重新执行测试验证并更新结果文件）`,
    "",
    "上次测试总结简述（请重点回归）：",
    summary.trim(),
  ].join("\n");
}

/** 复制源任务为 Pending（保留 thread_id 以便续跑） */
export function cloneTaskAsPending(
  db: DatabaseSync,
  source: TaskRow,
  overrides: {
    description: string;
    created_at: number;
    task_type?: TaskType;
    /** 未传则沿用源任务 title */
    title?: string;
    /** 未传则沿用源任务 thread_id；显式传 `null` 可清空（新类型任务勿续源会话） */
    thread_id?: string | null;
    /** 未传则沿用源任务 meta_json */
    meta_json?: string | null;
  },
): TaskRow {
  return createTask(db, {
    id: randomUUID(),
    title: overrides.title ?? source.title,
    description: overrides.description,
    status: TASK_STATUS.Pending,
    task_type: overrides.task_type ?? source.task_type,
    creator: source.creator,
    pid: source.pid,
    thread_id: overrides.thread_id !== undefined ? overrides.thread_id : source.thread_id,
    input_json: source.input_json,
    meta_json: overrides.meta_json !== undefined ? overrides.meta_json : source.meta_json,
    created_at: overrides.created_at,
    updated_at: overrides.created_at,
  });
}

export type CloneTasksOnTestNotFullyPassedResult = {
  devTask: TaskRow;
  testTask: TaskRow;
};

/**
 * 测试案例执行判定为代码问题且测试总结简述非空：复制新增同父任务下开发与测试执行（各自 followUpMessages 追加不同提示）、测试环境发布、部署间隔等待与发布结果任务。
 * 参考 {@link saveDescription4TasksUnderParent} 按 `pid` + `task_type` 定位源任务。
 */
export function cloneTasksOnTestNotFullyPassed(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskId: string,
  devFollowUpMessage: string,
  testFollowUpMessage: string,
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
        "cloneTasksOnTestNotFullyPassed: no test env deploy task under parent",
    );
    return null;
  }

  // 保留原 description；开发 / 测试执行各自追加不同 followUpMessages（续跑时作为 Agent 提示词）
  const devMetaJson = pushFollowUpMessageToTaskMeta(sourceDev.meta_json, devFollowUpMessage);
  const testMetaJson = pushFollowUpMessageToTaskMeta(executing.meta_json, testFollowUpMessage);
  const devTask = cloneTaskAsPending(db, sourceDev, {
    description: sourceDev.description,
    meta_json: devMetaJson,
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
    meta_json: testMetaJson,
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
