import type { DatabaseSync } from "node:sqlite";
import { resolveRepoIdFromGitRemoteUrl } from "../../../constants/appCatalog.js";
import type { ParentTaskRow } from "../../../db/parentTask.js";
import { parseTaskInputJson } from "../../../db/taskInputJson.js";
import { TASK_STATUS, updateTask, type TaskRow } from "../../../db/workflow.js";
import { AppLog } from "../../appLogger.js";
import { countTestEnvDeployTasksUnderParent } from "../../loop/cloneTasksOnTestNotFullyPassed.js";
import {
  devOpsDeployTestEnv,
  POST_DEPLOY_SLEEP_MS_MULTIPLE_DEPLOYS,
  resolveDevOpsDeployUrl,
} from "../../tools/devOpsDeployClient.js";

/**
 * 工具任务：a-测试环境发布（`task_type = 101`）。
 * 根据 `input_json.gitRemoteUrl` 从应用目录解析 app，结合 `branch_version` 调用 DevOps 部署，不经过 Claude 与提示词模板。
 */
export async function handleTestEnvDeployToolTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const log = AppLog.logger;
  const t = () => Date.now();
  const taskInputJson = parseTaskInputJson(task.input_json);

  const gitRemoteUrl = taskInputJson.gitRemoteUrl?.trim() || '';
  const gitBranch = taskInputJson.branch_version?.trim();
  const testEnv = taskInputJson.testEnv?.trim();
  const serverName = resolveRepoIdFromGitRemoteUrl(gitRemoteUrl, '');
  if (!gitBranch) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "缺少 input_json.branch_version，无法确定部署分支",
    });
    log.warn({ taskId: task.id }, "test env deploy: missing branch_version");
    return;
  }

  if (!serverName) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: `无法根据 gitRemoteUrl 解析应用 repoId：${gitRemoteUrl || "(空)"}`,
    });
    return;
  }

  if (!testEnv) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "缺少 input_json.testEnv（或父任务 init.testEnv），无法绑定测试环境",
    });
    log.warn({ taskId: task.id }, "test env deploy: missing testEnv");
    return;
  }

  const deployUrl = resolveDevOpsDeployUrl(db);
  if (!deployUrl) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message:
        "未配置 DevOps 部署地址：请设置环境变量 DEV_OPS_DEPLOY_URL 或全局 system_config.dev_ops_deploy_url",
    });
    log.warn({ taskId: task.id }, "test env deploy: deploy url not configured");
    return;
  }

  log.info(
    { taskId: task.id, parentPid: parentTask.pid, serverName, gitBranch, testEnv },
    "test env deploy: invoking DevOps",
  );

  const deployTaskCount = countTestEnvDeployTasksUnderParent(db, parentTask.pid);
  const postSuccessDelayMs =
    deployTaskCount > 1 ? POST_DEPLOY_SLEEP_MS_MULTIPLE_DEPLOYS : undefined;
  if (postSuccessDelayMs) {
    log.info(
      { taskId: task.id, parentPid: parentTask.pid, deployTaskCount },
      "test env deploy: multiple deploy tasks under parent, will sleep 5min after success",
    );
  }

  const deployResult = await devOpsDeployTestEnv(
    deployUrl,
    { gitBranch, serverName, env: testEnv },
    { postSuccessDelayMs },
  );
  const outputPayload = {
    deployUrl,
    serverName,
    gitBranch,
    testEnv,
    httpStatus: deployResult.status,
    responseBody: deployResult.body.slice(0, 4000),
  };

  if (!deployResult.ok) {
    const errMsg = `DevOps 部署 HTTP ${deployResult.status}: ${deployResult.body.slice(0, 500)}`;
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: errMsg,
      output_json: JSON.stringify(outputPayload),
    });
    log.error({ taskId: task.id, status: deployResult.status }, "test env deploy failed");
    return;
  }

  updateTask(db, task.id, {
    status: TASK_STATUS.Completed,
    completed_at: t(),
    error_message: null,
    output_json: JSON.stringify(outputPayload),
  });
  log.info({ taskId: task.id, serverName, gitBranch }, "test env deploy: completed");
}
