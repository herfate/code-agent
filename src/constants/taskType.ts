/**
 * 表 `tasks.task_type` 持久化数值（与页面中文一一对应）。父任务类型见 {@link parentAgentType.ts}。
 * 0 设计、1 开发、2 开发规范优化、3 测试预分析、4 测试案例设计、5 测试数据分析、
 * 6 测试案例执行、7 QA 平台测试脚本生成、101 测试环境发布（工具任务，非 Agent）。
 */
export const TASK_TYPE = {
  Design: 0,
  Dev: 1,
  DevSpecOptimize: 2,
  TestPreAnalysis: 3,
  TestCaseDesign: 4,
  TestDataAnalysis: 5,
  TestCaseExecute: 6,
  QaScriptGen: 7,
  /** 工具任务：调用 DevOps 部署测试环境，不走 Claude 提示词 */
  TestEnvDeploy: 101,
} as const;

/** 由定时扫描认领后走独立工具处理器（非 {@link handleClaimedAgentTask}） */
export const TOOL_TASK_TYPES: readonly TaskType[] = [TASK_TYPE.TestEnvDeploy];

export function isToolTaskType(taskType: TaskType): boolean {
  return (TOOL_TASK_TYPES as readonly number[]).includes(taskType);
}

/** 测试预分析（Agent 跑完后需人工确认，调度器会将「完成」改为「已暂停」） */
export function isTestPreAnalysisTaskType(taskType: TaskType): boolean {
  return taskType === TASK_TYPE.TestPreAnalysis;
}

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE];

/** @deprecated 使用 {@link TASK_TYPE.Dev} */
export const TASK_TYPE_DEV: TaskType = TASK_TYPE.Dev;

const TASK_TYPE_SET = new Set<number>(Object.values(TASK_TYPE) as TaskType[]);

export function isTaskType(n: unknown): n is TaskType {
  return typeof n === "number" && Number.isInteger(n) && TASK_TYPE_SET.has(n);
}

/** 从库行或请求参数解析任务类型，非法时默认开发（1） */
export function parseTaskType(raw: unknown): TaskType {
  return parseTaskTypeOptional(raw) ?? TASK_TYPE.Dev;
}

/** 可空任务类型解析（用于 `prompt_tpl.task_type` 等） */
export function parseTaskTypeOptional(raw: unknown): TaskType | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && isTaskType(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return null;
    const n = Number(t);
    if (isTaskType(n)) return n;
  }
  return null;
}

export function taskTypeLabel(code: TaskType | number | string): string {
  const n = typeof code === "number" ? code : Number(String(code).trim());
  switch (n) {
    case TASK_TYPE.Design:
      return "设计";
    case TASK_TYPE.Dev:
      return "开发";
    case TASK_TYPE.DevSpecOptimize:
      return "开发规范优化";
    case TASK_TYPE.TestPreAnalysis:
      return "测试预分析";
    case TASK_TYPE.TestCaseDesign:
      return "测试案例设计";
    case TASK_TYPE.TestDataAnalysis:
      return "测试数据分析";
    case TASK_TYPE.TestCaseExecute:
      return "测试案例执行";
    case TASK_TYPE.QaScriptGen:
      return "QA平台测试脚本生成";
    case TASK_TYPE.TestEnvDeploy:
      return "测试环境发布";
    default:
      return String(code);
  }
}
