/**
 * 表 `tasks.status` 持久化数值（与页面中文一一对应）。
 * 1 待执行、2 执行中、3 执行完成、4 执行失败、5 已暂停、6 已取消。
 */
export const TASK_STATUS = {
  Pending: 1,
  Running: 2,
  Completed: 3,
  Failed: 4,
  Paused: 5,
  Cancelled: 6,
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

const TASK_STATUS_SET = new Set<number>(Object.values(TASK_STATUS) as TaskStatus[]);

export function isTaskStatus(n: unknown): n is TaskStatus {
  return typeof n === "number" && Number.isInteger(n) && TASK_STATUS_SET.has(n);
}

export function taskStatusLabel(code: TaskStatus): string {
  switch (code) {
    case TASK_STATUS.Pending:
      return "待执行";
    case TASK_STATUS.Running:
      return "执行中";
    case TASK_STATUS.Completed:
      return "执行完成";
    case TASK_STATUS.Failed:
      return "执行失败";
    case TASK_STATUS.Paused:
      return "已暂停";
    case TASK_STATUS.Cancelled:
      return "已取消";
    default:
      return String(code);
  }
}
