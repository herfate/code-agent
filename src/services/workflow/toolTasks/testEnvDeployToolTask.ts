import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { resolveRepoIdFromGitRemoteUrl } from "../../../constants/appCatalog.js";
import { DEV_OPS_DEPLOY_PARAM_KEY } from "../../../constants/devOpsDeployParamKey.js";
import type { ParentTaskRow } from "../../../db/parentTask.js";
import { parseTaskInputJson, listTaskInputGitRepos } from "../../../db/taskInputJson.js";
import { TASK_STATUS, updateTask, upsertParentTaskParam, type TaskRow } from "../../../db/workflow.js";
import { AppLog } from "../../appLogger.js";
import {
  devOpsDeployTestEnv,
  resolveDevOpsDeployUrl,
} from "../../tools/devOpsDeployClient.js";

/**
 * 工具任务：a-测试环境发布（`task_type = 101`）。
 * 按 `input_json.gitRepos` 逐仓库解析 app 并调用 DevOps 部署。
 */
export async function handleTestEnvDeployToolTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const log = AppLog.logger;
  const t = () => Date.now();
  const taskInputJson = parseTaskInputJson(task.input_json);
  const gitRepos = listTaskInputGitRepos(taskInputJson);
  const testEnv = taskInputJson.testEnv?.trim();

  if (gitRepos.length === 0) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "缺少 input_json.gitRepos，无法确定部署仓库",
    });
    log.warn({ taskId: task.id }, "test env deploy: missing gitRepos");
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

  const deployResults: Array<Record<string, unknown>> = [];

  for (const repo of gitRepos) {
    const gitRemoteUrl = repo.gitRemoteUrl.trim();
    const gitBranch = repo.branch_version.trim();
    if (!gitBranch) {
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: `gitRepos 缺少 branch_version：${gitRemoteUrl || "(空)"}`,
      });
      log.warn({ taskId: task.id, gitRemoteUrl }, "test env deploy: missing branch_version");
      return;
    }

    const serverName = resolveRepoIdFromGitRemoteUrl(gitRemoteUrl, "");
    if (!serverName) {
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: `无法根据 gitRemoteUrl 解析应用 repoId：${gitRemoteUrl || "(空)"}`,
      });
      return;
    }

    log.info(
      { taskId: task.id, parentPid: parentTask.pid, serverName, gitBranch, testEnv, gitRemoteUrl },
      "test env deploy: invoking DevOps",
    );

    const deployResult = await devOpsDeployTestEnv(deployUrl, {
      gitBranch,
      serverName,
      env: testEnv,
    });
    const one: Record<string, unknown> = {
      gitRemoteUrl,
      deployUrl,
      serverName,
      gitBranch,
      testEnv,
      httpStatus: deployResult.status,
      responseBody: deployResult.body.slice(0, 4000),
    };
    if (deployResult.parsed) {
      one.deployResponse = deployResult.parsed;
    }
    deployResults.push(one);

    if (!deployResult.ok) {
      const errMsg = `DevOps 部署 HTTP ${deployResult.status}: ${deployResult.body.slice(0, 500)}`;
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: errMsg,
        output_json: JSON.stringify({ deployResults }),
      });
      log.error({ taskId: task.id, status: deployResult.status, gitRemoteUrl }, "test env deploy failed");
      return;
    }

    const parsed = deployResult.parsed;
    if (!parsed || parsed.status !== "success") {
      const errMsg = parsed
        ? `DevOps 部署业务失败 status=${parsed.status}: ${parsed.msg || deployResult.body.slice(0, 500)}`
        : `DevOps 部署响应无法解析: ${deployResult.body.slice(0, 500)}`;
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: errMsg,
        output_json: JSON.stringify({ deployResults }),
      });
      log.error({ taskId: task.id, parsedStatus: parsed?.status, gitRemoteUrl }, "test env deploy: bad response");
      return;
    }

    upsertParentTaskParam(db, {
      id: randomUUID(),
      parent_task_id: parentTask.pid,
      param_key: DEV_OPS_DEPLOY_PARAM_KEY.DevOpsDeployResult,
      value_json: JSON.stringify({
        ...parsed,
        serverName,
        gitBranch,
        testEnv,
        gitRemoteUrl,
        taskId: task.id,
      }),
      description: "测试环境 DevOps 部署触发响应（含 Jenkins pipeline result_url、node_url）",
    });
  }

  updateTask(db, task.id, {
    status: TASK_STATUS.Completed,
    completed_at: t(),
    error_message: null,
    output_json: JSON.stringify({ deployResults }),
  });
  log.info(
    { taskId: task.id, parentPid: parentTask.pid, repoCount: gitRepos.length },
    "test env deploy: completed",
  );
}
