import type { FastifyBaseLogger } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import {
  TASK_STATUS,
  claimTaskIfPending,
  listPendingTasksForScan,
  updateTask,
  type TaskRow,
} from "../db/workflow.js";
import { handleClaimedTask } from "./claimedTaskHandler.js";

export type TaskScanSchedulerHandle = { stop: () => void };

export function startTaskScanScheduler(opts: {
  db: DatabaseSync;
  intervalMs: number;
  batchSize: number;
  log: FastifyBaseLogger;
}): TaskScanSchedulerHandle | null {
  const { db, intervalMs, batchSize, log } = opts;
  if (intervalMs <= 0) return null;

  let stopped = false;
  let ticking = false;

  const runTick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const candidates = listPendingTasksForScan(db, batchSize);
      for (const task of candidates) {
        if (stopped) break;
        const claimed = claimTaskIfPending(db, task.id);
        if (!claimed) continue;
        try {
          await handleClaimedTask(db, claimed, log);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log.error({ err: e, taskId: claimed.id }, "task scan handler failed");
          failClaimedTask(db, claimed, msg);
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

function failClaimedTask(db: DatabaseSync, task: TaskRow, error_message: string): void {
  const t = Date.now();
  updateTask(db, task.id, {
    status: TASK_STATUS.Failed,
    error_message,
    completed_at: t,
  });
}
