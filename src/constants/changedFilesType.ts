import { TASK_TYPE, type TaskType } from "./taskType.js";

/**
 * 变更文件类型（字符串，作为 `parent_task_params.param_key`）。
 * `DesignOut` 设计输出、`TestDataAnalysisOut` 测试数据分析输出。
 */
export const CHANGED_FILES_TYPE = {
  DesignOut: "DesignOut",
  TestDataAnalysisOut: "TestDataAnalysisOut",
  TestPreAnalysisOut: "TestPreAnalysisOut",
  TestCaseDesignOut: "TestCaseDesignOut",
  TestCaseExecuteOut: "TestCaseExecuteOut",
} as const;

export type ChangedFilesType = (typeof CHANGED_FILES_TYPE)[keyof typeof CHANGED_FILES_TYPE];

const CHANGED_FILES_TYPE_SET = new Set<string>(Object.values(CHANGED_FILES_TYPE));

export function isChangedFilesType(v: unknown): v is ChangedFilesType {
  return typeof v === "string" && CHANGED_FILES_TYPE_SET.has(v);
}

/** 从请求参数或库字段解析变更文件类型 */
export function parseChangedFilesTypeOptional(raw: unknown): ChangedFilesType | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t === "") return null;
  return isChangedFilesType(t) ? t : null;
}

export function changedFilesTypeLabel(code: ChangedFilesType | string): string {
  switch (code) {
    case CHANGED_FILES_TYPE.DesignOut:
      return "设计输出";
    case CHANGED_FILES_TYPE.TestDataAnalysisOut:
      return "测试用例真实数据输出";
    case CHANGED_FILES_TYPE.TestPreAnalysisOut:
      return "测试数据分析输出";
    case CHANGED_FILES_TYPE.TestCaseDesignOut:
      return "测试用例输出";
    case CHANGED_FILES_TYPE.TestCaseExecuteOut:
      return "测试用例执行输出";
    default:
      return String(code);
  }
}

/** 按 `tasks.task_type` 解析 `parent_task_params.param_key`；无对应枚举时返回 `null`（如开发任务走 MR，不落库变更列表） */
export function changedFilesParamKeyForTaskType(taskType: TaskType): ChangedFilesType | null {
  switch (taskType) {
    case TASK_TYPE.Design:
      return CHANGED_FILES_TYPE.DesignOut;
    case TASK_TYPE.TestDataAnalysis:
      return CHANGED_FILES_TYPE.TestDataAnalysisOut;
    case TASK_TYPE.TestCaseDesign:
      return CHANGED_FILES_TYPE.TestCaseDesignOut;
    case TASK_TYPE.TestPreAnalysis:
      return CHANGED_FILES_TYPE.TestPreAnalysisOut;
    case TASK_TYPE.TestCaseExecute:
      return CHANGED_FILES_TYPE.TestCaseExecuteOut;
    default:
      return null;
  }
}
