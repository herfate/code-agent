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
  CodeReviewOut: "CodeReviewOut",
  StorySplitOut: "StorySplitOut",
  BrainstormOut: "BrainstormOut",
  /** AI 拆分故事（task_type=11）输出 */
  AiStorySplitOut: "AiStorySplitOut",
  /** UI 测试执行（task_type=12）输出 */
  UiTestExecuteOut: "UiTestExecuteOut",
  /** 生成业务知识（task_type=13）输出 */
  PersistMemoryOut: "PersistMemoryOut",
  /** 生成代码规范（task_type=14）输出 */
  GenCodeSpecOut: "GenCodeSpecOut",
  /** 生成测试规范（task_type=15）输出 */
  GenTestSpecOut: "GenTestSpecOut",
  /** 功能测试用例生成（task_type=20）输出 */
  FuncTestCaseGenOut: "FuncTestCaseGenOut",
  /** 自动化用例生成（task_type=21）输出 */
  AutoTestCaseGenOut: "AutoTestCaseGenOut",
  /** 测试脑图分析（task_type=22）输出 */
  TestMindMapAnalysisOut: "TestMindMapAnalysisOut",
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
    case CHANGED_FILES_TYPE.CodeReviewOut:
      return "Code Review 输出";
    case CHANGED_FILES_TYPE.StorySplitOut:
      return "拆分故事输出";
    case CHANGED_FILES_TYPE.BrainstormOut:
      return "头脑风暴输出";
    case CHANGED_FILES_TYPE.AiStorySplitOut:
      return "AI拆分故事输出";
    case CHANGED_FILES_TYPE.UiTestExecuteOut:
      return "UI测试执行输出";
    case CHANGED_FILES_TYPE.PersistMemoryOut:
      return "生成业务知识输出";
    case CHANGED_FILES_TYPE.GenCodeSpecOut:
      return "生成代码规范输出";
    case CHANGED_FILES_TYPE.GenTestSpecOut:
      return "生成测试规范输出";
    case CHANGED_FILES_TYPE.FuncTestCaseGenOut:
      return "功能测试用例生成输出";
    case CHANGED_FILES_TYPE.AutoTestCaseGenOut:
      return "自动化用例生成输出";
    case CHANGED_FILES_TYPE.TestMindMapAnalysisOut:
      return "测试脑图分析输出";
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
    case TASK_TYPE.CodeReview:
      return CHANGED_FILES_TYPE.CodeReviewOut;
    case TASK_TYPE.StorySplit:
      return CHANGED_FILES_TYPE.StorySplitOut;
    case TASK_TYPE.Brainstorm:
      return CHANGED_FILES_TYPE.BrainstormOut;
    case TASK_TYPE.AiStorySplit:
      return CHANGED_FILES_TYPE.AiStorySplitOut;
    case TASK_TYPE.UiTestExecute:
      return CHANGED_FILES_TYPE.UiTestExecuteOut;
    case TASK_TYPE.PersistMemory:
      return CHANGED_FILES_TYPE.PersistMemoryOut;
    case TASK_TYPE.GenCodeSpec:
      return CHANGED_FILES_TYPE.GenCodeSpecOut;
    case TASK_TYPE.GenTestSpec:
      return CHANGED_FILES_TYPE.GenTestSpecOut;
    case TASK_TYPE.FuncTestCaseGen:
      return CHANGED_FILES_TYPE.FuncTestCaseGenOut;
    case TASK_TYPE.AutoTestCaseGen:
      return CHANGED_FILES_TYPE.AutoTestCaseGenOut;
    case TASK_TYPE.TestMindMapAnalysis:
      return CHANGED_FILES_TYPE.TestMindMapAnalysisOut;
    default:
      return null;
  }
}
