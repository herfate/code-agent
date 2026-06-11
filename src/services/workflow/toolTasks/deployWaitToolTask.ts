import type { DatabaseSync } from "node:sqlite";
import type { ParentTaskRow } from "../../../db/parentTask.js";
import {
  addTaskCost,
  getTask,
  releaseClaimedTaskToPending,
  TASK_STATUS,
  updateTask,
  type TaskRow,
} from "../../../db/workflow.js";
import { AppLog } from "../../appLogger.js";

/** 同父任务多应用顺序部署时，两次部署之间的默认间隔（7 分钟） */
export const DEPLOY_WAIT_MS = 7 * 60 * 1000;


function resolveWaitMs(task: TaskRow): number {
  if (task.input_json?.trim()) {
    try {
      const raw = JSON.parse(task.input_json) as { waitMs?: unknown };
      const v = raw.waitMs;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
      if (typeof v === "string") {
        const n = Number(v.trim());
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
      }
    } catch {
      /* 使用默认等待时长 */
    }
  }
  return DEPLOY_WAIT_MS;
}

/** 将累计 cost 对齐到相对首次 started_at 的总等待时长 */
function alignWaitCostToElapsed(db: DatabaseSync, taskId: string, elapsed: number): void {
  const row = getTask(db, taskId);
  const already = row?.cost ?? 0;
  addTaskCost(db, taskId, Math.max(0, elapsed - already));
}

/**
 * 工具任务：部署间隔等待（`task_type = 102`）。
 * 认领后若未达等待时长则立即释放回待执行（不更新完成状态），不阻塞定时扫描；达到时长后标记完成。
 */
export async function handleDeployWaitToolTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const log = AppLog.logger;
  const segmentStart = Date.now();
  const waitMs = resolveWaitMs(task);
  const startedAt = task.started_at;
  if (startedAt == null) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: Date.now(),
      error_message: "部署等待任务缺少 started_at",
    });
    addTaskCost(db, task.id, Date.now() - segmentStart);
    log.warn({ taskId: task.id }, "deploy wait: missing started_at");
    return;
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed < waitMs) {
    const released = releaseClaimedTaskToPending(db, task.id);
    // 释放回 pending：累加本轮轮询耗时
    addTaskCost(db, task.id, Date.now() - segmentStart);
    log.info(
      {
        taskId: task.id,
        parentPid: parentTask.pid,
        waitMs,
        elapsedMs: elapsed,
        remainingMs: waitMs - elapsed,
        released,
      },
      "deploy wait: not yet, released to pending",
    );
    return;
  }

  const t = Date.now();
  // 最终完成：对齐到总等待时长（避免与多次 release 的小段重复累加）
  alignWaitCostToElapsed(db, task.id, elapsed);
  updateTask(db, task.id, {
    status: TASK_STATUS.Completed,
    completed_at: t,
    error_message: null,
    output_json: JSON.stringify({
      waitMs,
      startedAt,
      completedAt: t,
      elapsedMs: elapsed,
    }),
  });
  log.info(
    { taskId: task.id, parentPid: parentTask.pid, waitMs, elapsedMs: elapsed },
    "deploy wait: completed",
  );
}
