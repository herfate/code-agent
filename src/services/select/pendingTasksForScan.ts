import type { DatabaseSync } from "node:sqlite";
import {
  listPendingTasksForScanByParent,
  type PendingTaskForScanRow,
} from "../../db/select/pendingTasksForScanByParent.js";

export type { PendingTaskForScanRow };

/** 任务扫描：按父任务取最早 Pending；同 creator 默认同日不并行（`init.parallel` 可放宽） */
export function selectPendingTasksForScan(
  db: DatabaseSync,
  batchSize: number,
): PendingTaskForScanRow[] {
  return listPendingTasksForScanByParent(db, batchSize);
}
