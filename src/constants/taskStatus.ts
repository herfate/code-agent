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

/** 父任务列表展示用：按子任务 `tasks.status` 聚合为单一执行状态 */
export type ParentExecStatusLabel = "完成" | "待执行" | "失败" | "执行中" | "—";

export function aggregateParentExecStatus(statuses: number[]): ParentExecStatusLabel {
  const codes = statuses.filter(isTaskStatus);
  if (codes.length === 0) return "—";
  if (codes.every((s) => s === TASK_STATUS.Completed)) return "完成";
  if (codes.every((s) => s === TASK_STATUS.Pending)) return "待执行";
  if (codes.some((s) => s === TASK_STATUS.Failed)) return "失败";
  if (codes.some((s) => s === TASK_STATUS.Running)) return "执行中";
  return "—";
}
