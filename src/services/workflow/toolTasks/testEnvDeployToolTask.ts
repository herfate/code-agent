import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { APPS, listAppKeysByGitRemoteUrl } from "../../../constants/appCatalog.js";
import { DEV_OPS_DEPLOY_PARAM_KEY } from "../../../constants/devOpsDeployParamKey.js";
import type { ParentTaskRow } from "../../../db/parentTask.js";
import { parseTaskInputJson, listTaskInputGitRepos } from "../../../db/taskInputJson.js";
import { TASK_STATUS, updateTask, upsertParentTaskParam, addTaskCost, type TaskRow } from "../../../db/workflow.js";
import { AppLog } from "../../appLogger.js";
import {
  devOpsDeployTestEnv,
  resolveDevOpsDeployUrl,
  type DevOpsDeployPipelineItem,
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
  const segmentStart = Date.now();
  try {
    await runTestEnvDeployToolTask(db, task, parentTask);
  } finally {
    addTaskCost(db, task.id, Date.now() - segmentStart);
  }
}

async function runTestEnvDeployToolTask(
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

  const deployResults: Array<Record<string, unknown>> = [];
  /** 聚合所有部署结果的 data 条目（供下游 103 任务提取 node_url），附加来源标记便于人工排查 */
  type AggregatedDeployItem = DevOpsDeployPipelineItem & { serverName: string; gitRemoteUrl: string };
  const aggregatedData: AggregatedDeployItem[] = [];

  for (const repo of gitRepos) {
    const gitRemoteUrl = repo.gitRemoteUrl.trim();
    const gitBranch = repo.branch_version.trim();

    // 跳过无需发布的仓库，不参与部署：
    //  - common / ui / static：公共/前端/静态资源仓库
    //  - devops-std：SQL 脚本仓库，仅承载 DDL/DML 脚本，无需 DevOps 发布
    //  - *-knowledge / *-knowledge-*：知识库仓库，无需发布
    if (/common|ui|static|devops-std|-knowledge(-|$)/i.test(gitRemoteUrl)) {
      log.info(
        { taskId: task.id, gitRemoteUrl },
        "test env deploy: skipped (gitRemoteUrl contains 'common' / 'ui' / 'static' / 'devops-std' / '*-knowledge')",
      );
      continue;
    }

    if (!gitBranch) {
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: `gitRepos 缺少 branch_version：${gitRemoteUrl || "(空)"}`,
      });
      log.warn({ taskId: task.id, gitRemoteUrl }, "test env deploy: missing branch_version");
      return;
    }

    // 一个 git 地址可能对应多个应用（如 param-center-new 同时对应 param-console 和 param-server），
    // 此时按 repoId 全部部署，确保下游 103 任务能拿到所有应用的 node_url
    const matchedKeys = listAppKeysByGitRemoteUrl(gitRemoteUrl);
    if (matchedKeys.length === 0) {
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: `无法根据 gitRemoteUrl 解析应用 repoId：${gitRemoteUrl || "(空)"}`,
      });
      return;
    }

    for (const appKey of matchedKeys) {
      const serverName = APPS[appKey].repoId;
      log.info(
        { taskId: task.id, parentPid: parentTask.pid, serverName, gitBranch, testEnv, gitRemoteUrl, appKey },
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
        log.error({ taskId: task.id, status: deployResult.status, gitRemoteUrl, serverName }, "test env deploy failed");
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
        log.error({ taskId: task.id, parsedStatus: parsed?.status, gitRemoteUrl, serverName }, "test env deploy: bad response");
        return;
      }

      // 收集该应用的 pipeline data 条目，统一在循环外聚合落库
      // 给每条 item 附加来源标记（serverName / gitRemoteUrl），便于人工排查
      if (Array.isArray(parsed.data)) {
        for (const item of parsed.data) {
          aggregatedData.push({ ...item, serverName, gitRemoteUrl });
        }
      }
    }
  }

  // 所有仓库的所有应用部署成功后，把聚合的 pipeline data 落库，供下游 103 任务提取全部 node_url
  upsertParentTaskParam(db, {
    id: randomUUID(),
    parent_task_id: parentTask.pid,
    param_key: DEV_OPS_DEPLOY_PARAM_KEY.DevOpsDeployResult,
    value_json: JSON.stringify({
      status: "success",
      data: aggregatedData,
      msg: "",
      // 诊断字段（下游 103 只读 data[].node_url，不依赖这些）
      gitBranch: gitRepos[0]?.branch_version?.trim() ?? "",
      testEnv,
      taskId: task.id,
    }),
    description: "测试环境 DevOps 部署触发响应（含 Jenkins pipeline result_url、node_url）",
  });

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
