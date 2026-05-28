/**
 * 表 `parent_task.task_type` 持久化数值（父任务编排 Agent 类型，与子任务 {@link TASK_TYPE} 独立）。
 */
export const PARENT_AGENT_TYPE = {
  /** 开发自测编排（设计 → 开发 → 测试等子任务流水线） */
  DevSelfTest: 1,
  /** 开发自Review编排（设计 → 开发 -> review → 部署等子任务流水线） */
  DevReviewNoTest: 2,
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

export function parentAgentTypeLabel(code: ParentAgentType | number | string): string {
  const n = typeof code === "number" ? code : Number(String(code).trim());
  switch (n) {
    case PARENT_AGENT_TYPE.DevSelfTest:
      return "开发自测Agent";
    case PARENT_AGENT_TYPE.DevReviewNoTest:
      return "开发自Review Agent";
    default:
      return String(code);
  }
}
