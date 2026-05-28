import type { DatabaseSync } from "node:sqlite";
import {
  TASK_STATUS,
  claimTaskIfPending,
  getTask,
  updateTask,
  type TaskRow,
  TASK_TYPE,
} from "../../db/workflow.js";
import { notifyTaskExecuteFailed } from "../notify/taskExecuteNotify.js";
import { AppLog } from "../appLogger.js";
import { handleClaimedAgentTask } from "../workflow/claimedTaskHandler.js";
import { selectPendingTasksForScan } from "../select/pendingTasksForScan.js";
import type {ParentTaskRow} from "../../db/parentTask.js";
import { isTestPreAnalysisTaskType, isToolTaskType } from "../../constants/taskType.js";
import {handleTestEnvDeployToolTask} from "../workflow/toolTasks/testEnvDeployToolTask.js";

export type TaskScanSchedulerHandle = { stop: () => void };

export function startTaskScanScheduler(opts: {
  db: DatabaseSync;
  intervalMs: number;
  batchSize: number;
}): TaskScanSchedulerHandle | null {
  const { db, intervalMs, batchSize } = opts;
  const log = AppLog.logger;
  if (intervalMs <= 0) return null;

  let stopped = false;
  let ticking = false;

  const runTick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const candidates = selectPendingTasksForScan(db, batchSize);
      for (const { task, parent_task } of candidates) {
        if (stopped) break;
        const claimed = claimTaskIfPending(db, task.id);
        if (!claimed) continue;
        try {
          await handleClaimedTask(db, claimed, parent_task);
          pauseTestPreAnalysisIfCompleted(db, claimed.id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error({ err: e, taskId: claimed.id }, "task scan handler failed");
          failClaimedTask(db, claimed, msg);
        } finally {
          // 任务失败时发送通用企业微信通知
          try {
            await notifyIfTaskFailed(db, claimed.id, parent_task.pid);
          } catch (notifyErr) {
            log.error(
              { err: notifyErr, taskId: claimed.id },
              "notifyTaskExecuteFailed on task failure",
            );
          }
        }
      }
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => {
    void runTick().catch((e) => log.error({ err: e }, "task scan tick"));
  }, intervalMs);

  void runTick().catch((e) => log.error({ err: e }, "task scan initial tick"));

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}


/**
 * 定时扫描在将任务从待执行（1）原子认领为执行中（2）之后调用。
 * 工具类 `task_type` 走独立处理器；其余类型使用 `description` 作提示词调用 Claude Agent SDK。
 */
function handleClaimedTask(db: DatabaseSync, task: TaskRow, parentTask: ParentTaskRow): Promise<void> {
  if (isToolTaskType(task.task_type)) {
    if (task.task_type === TASK_TYPE.TestEnvDeploy) {
      return handleTestEnvDeployToolTask(db, task, parentTask);
    }
    throw new Error(`unsupported tool task_type: ${task.task_type}`);
  }
  return handleClaimedAgentTask(db, task, parentTask);
}

/** 测试预分析执行成功落库为「完成」后改为「已暂停」，同父任务后续子任务需人工确认后再推进 */
function pauseTestPreAnalysisIfCompleted(db: DatabaseSync, taskId: string): void {
  const row = getTask(db, taskId);
  if (
    !row ||
    row.status !== TASK_STATUS.Completed ||
    !isTestPreAnalysisTaskType(row.task_type)
  ) {
    return;
  }
  updateTask(db, taskId, { status: TASK_STATUS.Paused });
  AppLog.logger.info({ taskId, parentTaskId: row.pid }, "test pre-analysis paused for confirmation");
}

function failClaimedTask(db: DatabaseSync, task: TaskRow, error_message: string): void {
  const t = Date.now();
  updateTask(db, task.id, {
    status: TASK_STATUS.Failed,
    error_message,
    completed_at: t,
  });
}

/** 任务已标记失败时发送通用 Webhook 通知 */
async function notifyIfTaskFailed(
  db: DatabaseSync,
  taskId: string,
  parentTaskId: string,
): Promise<void> {
  const row = getTask(db, taskId);
  if (!row || row.status !== TASK_STATUS.Failed) {
    return;
  }
  await notifyTaskExecuteFailed(db, parentTaskId, taskId);
}
