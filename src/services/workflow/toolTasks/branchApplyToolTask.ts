import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DEV_OPS_DEPLOY_PARAM_KEY } from "../../../constants/devOpsDeployParamKey.js";
import type { ParentTaskRow } from "../../../db/parentTask.js";
import { parseTaskInputJson } from "../../../db/taskInputJson.js";
import { TASK_STATUS, updateTask, upsertParentTaskParam, addTaskCost, type TaskRow } from "../../../db/workflow.js";
import { AppLog } from "../../appLogger.js";
import { getQaCredentials } from "../../dbConfig.js";
import { resolveDevOpsDeployUrl } from "../../tools/devOpsDeployClient.js";
import { devOpsBranchApply } from "../../tools/devOpsBranchApplyClient.js";

/**
 * 工具任务：申请拉取分支（`task_type = 104`）。
 * 从 `input_json.branchApply` 取请求体，调用 DevOps `iter_apply_api` 创建分支申请订单。
 */
export async function handleBranchApplyToolTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const segmentStart = Date.now();
  try {
    await runBranchApplyToolTask(db, task, parentTask);
  } finally {
    addTaskCost(db, task.id, Date.now() - segmentStart);
  }
}

async function runBranchApplyToolTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const log = AppLog.logger;
  const t = () => Date.now();
  const taskInputJson = parseTaskInputJson(task.input_json);
  const payload = taskInputJson.branchApply;

  if (!payload) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "缺少 input_json.branchApply，无法申请拉取分支",
    });
    log.warn({ taskId: task.id }, "branch apply: missing branchApply payload");
    return;
  }

  const baseUrl = resolveDevOpsDeployUrl(db);

  // 认证凭据：用 qa_platform_username/password 登录 DevOps 换取 SimpleJWT access token
  const creds = getQaCredentials(db);
  if (!creds || !creds.passWord) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "未配置认证凭据：请在全局 system_config 设置 qa_platform_username / qa_platform_password",
    });
    log.warn({ taskId: task.id }, "branch apply: qa credentials not configured");
    return;
  }

  log.info(
    { taskId: task.id, parentPid: parentTask.pid, gitlabGroup: payload.gitlab_group, branchName: payload.branch_name },
    "branch apply: invoking DevOps iter_apply_api",
  );

  const result = await devOpsBranchApply(baseUrl, payload, creds.userName, creds.passWord);
  const output: Record<string, unknown> = {
    baseUrl,
    gitlabGroup: payload.gitlab_group,
    branchName: payload.branch_name,
    httpStatus: result.status,
    responseBody: result.body.slice(0, 4000),
  };
  if (result.parsed) {
    output.applyResponse = result.parsed;
  }

  if (!result.ok) {
    const errMsg = `申请拉取分支 HTTP ${result.status}: ${result.body.slice(0, 500)}`;
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: errMsg,
      output_json: JSON.stringify({ output }),
    });
    log.error({ taskId: task.id, status: result.status }, "branch apply failed");
    return;
  }

  const parsed = result.parsed;
  if (!parsed || parsed.status !== "success") {
    const errMsg = parsed
      ? `申请拉取分支业务失败 status=${parsed.status}: ${parsed.msg || result.body.slice(0, 500)}`
      : `申请拉取分支响应无法解析: ${result.body.slice(0, 500)}`;
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: errMsg,
      output_json: JSON.stringify({ output }),
    });
    log.error({ taskId: task.id, parsedStatus: parsed?.status }, "branch apply: bad response");
    return;
  }

  upsertParentTaskParam(db, {
    id: randomUUID(),
    parent_task_id: parentTask.pid,
    param_key: DEV_OPS_DEPLOY_PARAM_KEY.DevOpsBranchApplySid,
    value_json: JSON.stringify({
      ...parsed,
      gitlabGroup: payload.gitlab_group,
      branchName: payload.branch_name,
      taskId: task.id,
    }),
    description: "申请拉取分支订单（iter_apply_api 返回 sid）",
  });

  updateTask(db, task.id, {
    status: TASK_STATUS.Completed,
    completed_at: t(),
    error_message: null,
    output_json: JSON.stringify({ output }),
  });
  log.info(
    { taskId: task.id, parentPid: parentTask.pid, sid: parsed.data.sid },
    "branch apply: completed",
  );
}
