import type { DatabaseSync } from "node:sqlite";
import { TASK_TYPE, taskTypeLabel, getTask, listTasksByPid, type TaskRow } from "../../db/workflow.js";
import { AppLog } from "../appLogger.js";
import { cloneTaskAsPending } from "./cloneTasksOnTestNotFullyPassed.js";

/** 同父任务下已存在的 UI 测试执行任务数 */
export function countUiTestExecuteTasksUnderParent(db: DatabaseSync, parentTaskId: string): number {
  return listTasksByPid(db, parentTaskId).filter((t) => t.task_type === TASK_TYPE.UiTestExecute)
    .length;
}

/**
 * 开发提交含 UI 源码时：复制 Design 生成一条 UI 测试执行任务。
 * 同一父任务下仅生成一次（已存在则跳过）。
 */
export function cloneUiTestExecuteFromDesign(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskId: string,
): TaskRow | null {
  const executing = getTask(db, executingTaskId);
  if (!executing || executing.pid !== parentTaskId) {
    AppLog.logger.warn(
      { parentTaskId, executingTaskId },
      "cloneUiTestExecuteFromDesign: executing task not found",
    );
    return null;
  }
  if (executing.task_type !== TASK_TYPE.Dev) {
    return null;
  }

  const existingCount = countUiTestExecuteTasksUnderParent(db, parentTaskId);
  if (existingCount > 0) {
    AppLog.logger.info(
      { parentTaskId, existingCount },
      "cloneUiTestExecuteFromDesign: ui test execute already exists, skip",
    );
    return null;
  }

  const tasks = listTasksByPid(db, parentTaskId);
  const sourceDesign = [...tasks].reverse().find((t) => t.task_type === TASK_TYPE.Design);
  if (!sourceDesign) {
    AppLog.logger.warn({ parentTaskId }, "cloneUiTestExecuteFromDesign: no design task under parent");
    return null;
  }

  // 排在测试环境发布结果之后（若无则跟在开发之后），避免打乱原有流水线 created_at 间距
  const anchor =
    [...tasks].reverse().find((t) => t.task_type === TASK_TYPE.TestEnvDeployResult) ??
    [...tasks].reverse().find((t) => t.task_type === TASK_TYPE.TestEnvDeploy) ??
    executing;

  const designLabel = taskTypeLabel(TASK_TYPE.Design);
  const uiLabel = taskTypeLabel(TASK_TYPE.UiTestExecute);
  const titleSuffix = ` - ${designLabel}`;
  const title = sourceDesign.title.endsWith(titleSuffix)
    ? `${sourceDesign.title.slice(0, -titleSuffix.length)} - ${uiLabel}`
    : `${sourceDesign.title} - ${uiLabel}`;

  const uiTask = cloneTaskAsPending(db, sourceDesign, {
    title,
    description: sourceDesign.description,
    task_type: TASK_TYPE.UiTestExecute,
    thread_id: null, // 新任务类型，不续 Design 会话
    created_at: anchor.created_at + 1,
  });

  AppLog.logger.info(
    {
      parentTaskId,
      sourceDesignTaskId: sourceDesign.id,
      executingDevTaskId: executing.id,
      newUiTestExecuteTaskId: uiTask.id,
    },
    "cloneUiTestExecuteFromDesign: cloned design as ui test execute",
  );

  return uiTask;
}
