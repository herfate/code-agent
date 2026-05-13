import { TASK_TYPE, type TaskType } from "./taskType.js";

/** `parent_task_params.param_key`：各测试阶段 Agent 输出中的通过率 / 执行结果 */
export const TEST_PASS_RATE_PARAM_KEY = {
  TestCaseExecutePassRate: "TestCaseExecutePassRate",
  TestCaseExecutePassResult: "TestCaseExecutePassResult",
} as const;

export type TestPassRateParamKey =
  (typeof TEST_PASS_RATE_PARAM_KEY)[keyof typeof TEST_PASS_RATE_PARAM_KEY];

const TEST_PASS_RATE_PARAM_KEY_SET = new Set<string>(Object.values(TEST_PASS_RATE_PARAM_KEY));

export function isTestPassRateParamKey(v: unknown): v is TestPassRateParamKey {
  return typeof v === "string" && TEST_PASS_RATE_PARAM_KEY_SET.has(v);
}

export function testPassRateParamKeyLabel(code: TestPassRateParamKey | string): string {
  switch (code) {
    case TEST_PASS_RATE_PARAM_KEY.TestCaseExecutePassRate:
      return "测试用例执行通过率";
    case TEST_PASS_RATE_PARAM_KEY.TestCaseExecutePassResult:
      return "测试用例执行结果";
    default:
      return String(code);
  }
}

/** 按 `tasks.task_type` 解析需落库的测试结果 `param_key` 列表 */
export function testPassParamKeysForTaskType(taskType: TaskType): readonly TestPassRateParamKey[] {
  switch (taskType) {
    case TASK_TYPE.TestCaseExecute:
      return [
        TEST_PASS_RATE_PARAM_KEY.TestCaseExecutePassRate,
        TEST_PASS_RATE_PARAM_KEY.TestCaseExecutePassResult,
      ];
    default:
      return [];
  }
}
