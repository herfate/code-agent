import { TASK_TYPE, type TaskType } from "./taskType.js";

/** `parent_task_params.param_key`：Code Review Agent 输出中的门禁与摘要 */
export const CODE_REVIEW_GATE_PARAM_KEY = {
  /** 是否允许合并（boolean，供流水线门禁） */
  CodeReviewMergeAllowed: "CodeReviewMergeAllowed",
  /** 完整审查摘要（verdict、counts、must_fix、summary 等） */
  CodeReviewGateResult: "CodeReviewGateResult",
} as const;

export type CodeReviewGateParamKey =
  (typeof CODE_REVIEW_GATE_PARAM_KEY)[keyof typeof CODE_REVIEW_GATE_PARAM_KEY];

const CODE_REVIEW_GATE_PARAM_KEY_SET = new Set<string>(
  Object.values(CODE_REVIEW_GATE_PARAM_KEY),
);

export function isCodeReviewGateParamKey(v: unknown): v is CodeReviewGateParamKey {
  return typeof v === "string" && CODE_REVIEW_GATE_PARAM_KEY_SET.has(v);
}

export function codeReviewGateParamKeyLabel(code: CodeReviewGateParamKey | string): string {
  switch (code) {
    case CODE_REVIEW_GATE_PARAM_KEY.CodeReviewMergeAllowed:
      return "Code Review 合并门禁";
    case CODE_REVIEW_GATE_PARAM_KEY.CodeReviewGateResult:
      return "Code Review 审查摘要";
    default:
      return String(code);
  }
}

/** 按 `tasks.task_type` 解析需落库的 Code Review 门禁 `param_key` 列表 */
export function codeReviewGateParamKeysForTaskType(
  taskType: TaskType,
): readonly CodeReviewGateParamKey[] {
  switch (taskType) {
    case TASK_TYPE.CodeReview:
      return [
        CODE_REVIEW_GATE_PARAM_KEY.CodeReviewMergeAllowed,
        CODE_REVIEW_GATE_PARAM_KEY.CodeReviewGateResult,
      ];
    default:
      return [];
  }
}
