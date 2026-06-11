import { PARENT_AGENT_TYPE, type ParentAgentType } from "../../constants/parentAgentType.js";
import { TASK_TYPE, type TaskType } from "../../constants/taskType.js";

/** 开发自Review 且未配置 testEnv 时不生成测试环境发布（101）与发布结果（103）节点 */
export function isDevReviewSkipTestEnv(
  parentTaskType: ParentAgentType | number,
  testEnv: string | undefined,
): boolean {
  return parentTaskType === PARENT_AGENT_TYPE.DevReviewNoTest && !testEnv?.trim();
}

/** 开发自Review 无 testEnv 时从编排中剔除 101、103 */
export function filterWorkflowTypesForTestEnv(
  parentTaskType: ParentAgentType | number,
  testEnv: string | undefined,
  workflowTypes: readonly TaskType[],
): TaskType[] {
  if (!isDevReviewSkipTestEnv(parentTaskType, testEnv)) {
    return [...workflowTypes];
  }
  return workflowTypes.filter(
    (t) => t !== TASK_TYPE.TestEnvDeploy && t !== TASK_TYPE.TestEnvDeployResult,
  );
}
