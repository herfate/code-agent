/** `parent_task_params.param_key`：用户手动录入的用例采纳率（0–100，百分比数值） */
export const TEST_CASE_ADOPTION_RATE_PARAM_KEY = "TestCaseAdoptionRate";

/** 允许前端直接 upsert 的父任务参数字段（非 Agent 落库保留键） */
export const USER_EDITABLE_PARENT_PARAM_KEYS = [TEST_CASE_ADOPTION_RATE_PARAM_KEY] as const;

export type UserEditableParentParamKey = (typeof USER_EDITABLE_PARENT_PARAM_KEYS)[number];

const USER_EDITABLE_PARENT_PARAM_KEY_SET = new Set<string>(USER_EDITABLE_PARENT_PARAM_KEYS);

export function isUserEditableParentParamKey(v: unknown): v is UserEditableParentParamKey {
  return typeof v === "string" && USER_EDITABLE_PARENT_PARAM_KEY_SET.has(v);
}

/** 解析 `value_json` 为 0–100 的采纳率；无法解析时返回 `null` */
export function parseTestCaseAdoptionRateValueJson(valueJson: string | undefined | null): number | null {
  if (valueJson == null || valueJson === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(valueJson);
  } catch {
    return null;
  }
  if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
  if (typeof parsed === "string") {
    const t = parsed.trim().replace(/%$/, "");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 校验并规范化为 JSON 字符串（存库用） */
export function normalizeTestCaseAdoptionRateValue(value: unknown): string {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const t = value.trim().replace(/%$/, "");
    if (!t) throw new Error("invalid adoption rate");
    n = Number(t);
  } else {
    throw new Error("invalid adoption rate");
  }
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error("adoption rate must be between 0 and 100");
  }
  return JSON.stringify(n);
}
