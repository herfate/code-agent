import type { DatabaseSync } from "node:sqlite";
import {
  listPendingTasksForScanByParent,
  type PendingTaskForScanRow,
} from "../../db/select/pendingTasksForScanByParent.js";

export type { PendingTaskForScanRow };

/** 任务扫描：按父任务分组，每组取最早一条待执行任务（含父任务信息） */
export function selectPendingTasksForScan(
  db: DatabaseSync,
  batchSize: number,
): PendingTaskForScanRow[] {
  return listPendingTasksForScanByParent(db, batchSize);
}
