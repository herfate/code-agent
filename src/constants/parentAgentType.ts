/**
 * 表 `parent_task.task_type` 持久化数值（父任务编排 Agent 类型，与子任务 {@link TASK_TYPE} 独立）。
 */
export const PARENT_AGENT_TYPE = {
  /** 开发自测编排（设计 → 开发 → 测试等子任务流水线） */
  DevSelfTest: 1,
  /** 开发自Review编排（设计 → 开发 → 测试环境发布 → Code Review 等子任务流水线） */
  DevReviewNoTest: 2,
  /** 功能测试编排（测试环境发布 → 测试设计-> 测试案例设计-> 测试数据分析-> 测试案例执行） */
  FuncTest: 3,
  /** 业务编排（业务相关子任务流水线） */
  BizAgent: 4,
  /** 测试案例编排（功能测试用例生成 → 测试脑图分析；仓库与测试环境必填） */
  TestCaseOrchestrate: 5,
  /** 自动化测试编排（功能测试用例生成 → 自动化用例生成；仓库与测试环境必填） */
  AutoTest: 6,
} as const;

export type ParentAgentType = (typeof PARENT_AGENT_TYPE)[keyof typeof PARENT_AGENT_TYPE];

const PARENT_AGENT_TYPE_SET = new Set<number>(
  Object.values(PARENT_AGENT_TYPE) as ParentAgentType[],
);

export function isParentAgentType(n: unknown): n is ParentAgentType {
  return typeof n === "number" && Number.isInteger(n) && PARENT_AGENT_TYPE_SET.has(n);
}

/** 从库行或请求参数解析父任务 Agent 类型，非法时默认开发自测（1） */
export function parseParentAgentType(raw: unknown): ParentAgentType {
  return parseParentAgentTypeOptional(raw) ?? PARENT_AGENT_TYPE.DevSelfTest;
}

/** 可空父任务 Agent 类型解析 */
export function parseParentAgentTypeOptional(raw: unknown): ParentAgentType | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && isParentAgentType(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return null;
    const n = Number(t);
    if (isParentAgentType(n)) return n;
  }
  return null;
}

/** 解析逗号分隔的父任务类型列表（非法项返回 undefined） */
export function parseParentAgentTypesCsv(raw: unknown): ParentAgentType[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const types: ParentAgentType[] = [];
  for (const part of s.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const n = Number(t);
    if (!isParentAgentType(n)) return undefined;
    types.push(n);
  }
  return types.length > 0 ? types : undefined;
}

/** 开发/测试编排类型（1 开发自测、2 开发自Review、3 功能测试、5 测试案例编排、6 自动化测试） */
export function isDevWorkflowParentTaskType(taskType: ParentAgentType | number): boolean {
  return (
    taskType === PARENT_AGENT_TYPE.DevSelfTest ||
    taskType === PARENT_AGENT_TYPE.DevReviewNoTest ||
    taskType === PARENT_AGENT_TYPE.FuncTest ||
    taskType === PARENT_AGENT_TYPE.TestCaseOrchestrate ||
    taskType === PARENT_AGENT_TYPE.AutoTest
  );
}

/** 创建父任务时 testEnv 必填（类型 1、3、5、6；类型 2 可选） */
export function isTestEnvRequiredForParentTaskType(taskType: ParentAgentType | number): boolean {
  return (
    taskType === PARENT_AGENT_TYPE.DevSelfTest ||
    taskType === PARENT_AGENT_TYPE.FuncTest ||
    taskType === PARENT_AGENT_TYPE.TestCaseOrchestrate ||
    taskType === PARENT_AGENT_TYPE.AutoTest
  );
}

/** 创建父任务时 testScriptRepo 必填（类型 5） */
export function isTestScriptRepoRequiredForParentTaskType(taskType: ParentAgentType | number): boolean {
  return taskType === PARENT_AGENT_TYPE.TestCaseOrchestrate;
}

export function parentAgentTypeLabel(code: ParentAgentType | number | string): string {
  const n = typeof code === "number" ? code : Number(String(code).trim());
  switch (n) {
    case PARENT_AGENT_TYPE.DevSelfTest:
      return "开发自测Agent";
    case PARENT_AGENT_TYPE.DevReviewNoTest:
      return "开发自Review Agent";
    case PARENT_AGENT_TYPE.FuncTest:
      return "功能测试Agent";
    case PARENT_AGENT_TYPE.BizAgent:
      return "业务Agent";
    case PARENT_AGENT_TYPE.TestCaseOrchestrate:
      return "测试案例编排Agent";
    case PARENT_AGENT_TYPE.AutoTest:
      return "自动化测试Agent";
    default:
      return String(code);
  }
}
