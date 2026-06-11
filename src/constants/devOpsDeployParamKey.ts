/** `parent_task_params.param_key`：测试环境 DevOps 部署触发响应（含 Jenkins pipeline `result_url`、`node_url`） */
export const DEV_OPS_DEPLOY_PARAM_KEY = {
  DevOpsDeployResult: "DevOpsDeployResult",
  /** Jenkins 节点列表中首个 `result=FAILURE` 的节点（`task_type=103` 落库） */
  TestEnvDeployResult: "TestEnvDeployResult",
  /** 申请拉取分支订单 sid（iter_apply_api 返回，`task_type=104` 落库） */
  DevOpsBranchApplySid: "DevOpsBranchApplySid",
} as const;

export type DevOpsDeployParamKey =
  (typeof DEV_OPS_DEPLOY_PARAM_KEY)[keyof typeof DEV_OPS_DEPLOY_PARAM_KEY];
