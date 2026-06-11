import type { DatabaseSync } from "node:sqlite";
import {
  TASK_STATUS,
  claimTaskIfPending,
  getTask,
  updateTask,
  type TaskRow,
  TASK_TYPE,
} from "../../db/workflow.js";
import { notifyTaskExecuteResult } from "../notify/taskExecuteNotify.js";
import { AppLog } from "../appLogger.js";
import { handleClaimedAgentTask } from "../workflow/claimedTaskHandler.js";
import { selectPendingTasksForScan, type PendingTaskForScanRow } from "../select/pendingTasksForScan.js";
import { isDirectDevAfterDesign, getParentTask, type ParentTaskRow } from "../../db/parentTask.js";
import { isToolTaskType } from "../../constants/taskType.js";
import { PARENT_AGENT_TYPE } from "../../constants/parentAgentType.js";
import {handleTestEnvDeployToolTask} from "../workflow/toolTasks/testEnvDeployToolTask.js";
import {handleDeployWaitToolTask} from "../workflow/toolTasks/deployWaitToolTask.js";
import {handleTestEnvDeployResultToolTask} from "../workflow/toolTasks/testEnvDeployResultToolTask.js";
import {handleBranchApplyToolTask} from "../workflow/toolTasks/branchApplyToolTask.js";
import {
  CLAIMED_TASK_MAX_RETRIES,
  CLAIMED_TASK_RETRY_DELAY_MS,
  shouldRetryClaimedTask,
} from "./claimedTaskRetry.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  /** 仅覆盖「选任务 + 认领派发」短临界区，不等待任务执行完成 */
  let ticking = false;
  /** 后台执行中的任务（上限为 batchSize，空出槽位后下一轮扫描可继续认领） */
  const inFlight = new Set<Promise<void>>();

  const processCandidate = async ({ task, parent_task }: PendingTaskForScanRow): Promise<void> => {
    if (stopped) return;
    const claimed = claimTaskIfPending(db, task.id);
    if (!claimed) return;
    try {
      for (let attempt = 0; attempt <= CLAIMED_TASK_MAX_RETRIES; attempt++) {
        try {
          await handleClaimedTask(db, claimed, parent_task);
          pauseTaskForManualConfirmIfCompleted(db, claimed.id);
          return;
        } catch (e) {
          if (!shouldRetryClaimedTask(claimed, e) || attempt >= CLAIMED_TASK_MAX_RETRIES) {
            throw e;
          }
          log.warn(
            { err: e, taskId: claimed.id, attempt: attempt + 1, maxRetries: CLAIMED_TASK_MAX_RETRIES },
            "task scan handler failed, will retry",
          );
          await sleep(CLAIMED_TASK_RETRY_DELAY_MS);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: e, taskId: claimed.id }, "task scan handler failed");
      failClaimedTask(db, claimed, msg);
    } finally {
      // 任务结束（成功/失败）时发送企业微信通知
      try {
        await notifyTaskExecuteResult(db, parent_task.pid, claimed.id);
      } catch (notifyErr) {
        log.error({ err: notifyErr, taskId: claimed.id }, "notifyTaskExecuteResult failed");
      }
    }
  };

  /** 派发后台执行，不阻塞扫描周期 */
  const dispatchCandidate = (row: PendingTaskForScanRow): void => {
    let p!: Promise<void>;
    p = processCandidate(row)
      .catch((e) => {
        log.error({ err: e, taskId: row.task.id }, "task scan processCandidate");
      })
      .finally(() => {
        inFlight.delete(p);
      });
    inFlight.add(p);
  };

  const runTick = () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const slots = Math.max(0, batchSize - inFlight.size);
      if (slots === 0) return;
      const candidates = selectPendingTasksForScan(db, slots);
      for (const row of candidates) {
        dispatchCandidate(row);
      }
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => {
    try {
      runTick();
    } catch (e) {
      log.error({ err: e }, "task scan tick");
    }
  }, intervalMs);

  try {
    runTick();
  } catch (e) {
    log.error({ err: e }, "task scan initial tick");
  }

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
    if (task.task_type === TASK_TYPE.DeployWait) {
      return handleDeployWaitToolTask(db, task, parentTask);
    }
    if (task.task_type === TASK_TYPE.TestEnvDeployResult) {
      return handleTestEnvDeployResultToolTask(db, task, parentTask);
    }
    if (task.task_type === TASK_TYPE.BranchApply) {
      return handleBranchApplyToolTask(db, task, parentTask);
    }
    throw new Error(`unsupported tool task_type: ${task.task_type}`);
  }
  return handleClaimedAgentTask(db, task, parentTask);
}

/** 设计任务执行成功落库为「完成」后改为「已暂停」，需人工确认后再推进；`init.directDevAfterDesign` 为 true 时跳过 */
function pauseTaskForManualConfirmIfCompleted(db: DatabaseSync, taskId: string): void {
  const row = getTask(db, taskId);
  if (!row || row.status !== TASK_STATUS.Completed) {
    return;
  }
  // 仅设计任务需暂停：父任务为开发自测（1）或开发自Review（2），且未勾选 directDevAfterDesign
  if (row.task_type !== TASK_TYPE.Design || !row.pid) {
    return;
  }
  const parent = getParentTask(db, row.pid);
  if (
    parent &&
    (parent.task_type === PARENT_AGENT_TYPE.DevSelfTest ||
      parent.task_type === PARENT_AGENT_TYPE.DevReviewNoTest) &&
    !isDirectDevAfterDesign(db, row.pid)
  ) {
    updateTask(db, taskId, { status: TASK_STATUS.Paused });
    AppLog.logger.info(
      { taskId, parentTaskId: row.pid, parentTaskType: parent.task_type },
      "design task paused for confirmation",
    );
  }
}

function failClaimedTask(db: DatabaseSync, task: TaskRow, error_message: string): void {
  const t = Date.now();
  updateTask(db, task.id, {
    status: TASK_STATUS.Failed,
    error_message,
    completed_at: t,
  });
}
