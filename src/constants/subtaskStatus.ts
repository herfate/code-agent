/**
 * 表 `subtasks.status` 持久化数值。
 * 1 待执行、2 执行中、3 执行完成、4 执行失败、5 已跳过、6 已取消。
 */
export const SUBTASK_STATUS = {
  Pending: 1,
  Running: 2,
  Completed: 3,
  Failed: 4,
  Skipped: 5,
  Cancelled: 6,
} as const;

export type SubTaskStatus = (typeof SUBTASK_STATUS)[keyof typeof SUBTASK_STATUS];

const SUBTASK_STATUS_SET = new Set<number>(Object.values(SUBTASK_STATUS) as SubTaskStatus[]);

export function isSubTaskStatus(n: unknown): n is SubTaskStatus {
  return typeof n === "number" && Number.isInteger(n) && SUBTASK_STATUS_SET.has(n);
}

export function subtaskStatusLabel(code: SubTaskStatus): string {
  switch (code) {
    case SUBTASK_STATUS.Pending:
      return "待执行";
    case SUBTASK_STATUS.Running:
      return "执行中";
    case SUBTASK_STATUS.Completed:
      return "执行完成";
    case SUBTASK_STATUS.Failed:
      return "执行失败";
    case SUBTASK_STATUS.Skipped:
      return "已跳过";
    case SUBTASK_STATUS.Cancelled:
      return "已取消";
    default:
      return String(code);
  }
}
