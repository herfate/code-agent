import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DEV_OPS_DEPLOY_PARAM_KEY } from "../../../constants/devOpsDeployParamKey.js";
import type { ParentTaskRow } from "../../../db/parentTask.js";
import {
  getParentTaskParamByParentAndKey,
  releaseClaimedTaskToPending,
  TASK_STATUS,
  updateTask,
  upsertParentTaskParam,
  type TaskRow,
} from "../../../db/workflow.js";
import { AppLog } from "../../appLogger.js";
import { getGlobalMaxRetryCount } from "../../dbConfig.js";
import {
  buildTestEnvDeployFailureDescription,
  cloneTasksOnTestEnvDeployFailed,
  countTestEnvDeployResultTasksUnderParent,
} from "../../loop/cloneTasksOnTestEnvDeployFailed.js";
import {
  extractNodeUrlsFromDevOpsDeployResult,
  fetchJenkinsPipelineNodes,
  findFirstFailurePipelineNode,
  isJenkinsPipelineStillRunning,
  type JenkinsPipelineNode,
} from "../../tools/devOpsDeployClient.js";

/** 轮询 Jenkins 节点列表的最长等待（默认 30 分钟） */
export const TEST_ENV_DEPLOY_RESULT_POLL_MS = 30 * 60 * 1000;

function resolvePollTimeoutMs(task: TaskRow): number {
  if (task.input_json?.trim()) {
    try {
      const raw = JSON.parse(task.input_json) as { pollTimeoutMs?: unknown };
      const v = raw.pollTimeoutMs;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
      if (typeof v === "string") {
        const n = Number(v.trim());
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
      }
    } catch {
      /* 使用默认轮询时长 */
    }
  }
  return TEST_ENV_DEPLOY_RESULT_POLL_MS;
}

function completeDeployResultTask(
  db: DatabaseSync,
  taskId: string,
  output: Record<string, unknown>,
): void {
  updateTask(db, taskId, {
    status: TASK_STATUS.Completed,
    completed_at: Date.now(),
    error_message: null,
    output_json: JSON.stringify(output),
  });
}

/**
 * 工具任务：测试环境发布结果（`task_type = 103`）。
 * 从 `parent_task_params.DevOpsDeployResult` 的 `node_url` 拉取节点，取首个 FAILURE 落库。
 */
export async function handleTestEnvDeployResultToolTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const log = AppLog.logger;
  const t = () => Date.now();
  const pollTimeoutMs = resolvePollTimeoutMs(task);

  const deployParam = getParentTaskParamByParentAndKey(
    db,
    parentTask.pid,
    DEV_OPS_DEPLOY_PARAM_KEY.DevOpsDeployResult,
  );
  if (!deployParam?.value_json?.trim()) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "缺少 parent_task_params.DevOpsDeployResult，请先完成测试环境发布（101）",
    });
    log.warn({ taskId: task.id, parentPid: parentTask.pid }, "test env deploy result: missing DevOpsDeployResult");
    return;
  }

  const nodeUrls = extractNodeUrlsFromDevOpsDeployResult(deployParam.value_json);
  if (nodeUrls.length === 0) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "DevOpsDeployResult 中无 node_url，无法查询 Jenkins 节点",
    });
    log.warn({ taskId: task.id, parentPid: parentTask.pid }, "test env deploy result: no node_url");
    return;
  }

  const startedAt = task.started_at;
  if (startedAt == null) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "测试环境发布结果任务缺少 started_at",
    });
    log.warn({ taskId: task.id }, "test env deploy result: missing started_at");
    return;
  }

  const fetchResults: Array<Record<string, unknown>> = [];
  let firstFailure: JenkinsPipelineNode | undefined;
  let failureNodeUrl: string | undefined;
  let stillRunning = false;

  for (const nodeUrl of nodeUrls) {
    const fetched = await fetchJenkinsPipelineNodes(nodeUrl);
    const one: Record<string, unknown> = { nodeUrl, httpStatus: fetched.status };
    if (!fetched.ok) {
      one.error = fetched.body.slice(0, 2000);
      fetchResults.push(one);
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: `拉取 Jenkins 节点失败 HTTP ${fetched.status}: ${fetched.body.slice(0, 500)}`,
        output_json: JSON.stringify({ fetchResults }),
      });
      log.error({ taskId: task.id, nodeUrl, status: fetched.status }, "test env deploy result: fetch failed");
      return;
    }

    const nodes = fetched.nodes ?? [];
    one.nodeCount = nodes.length;
    fetchResults.push(one);

    const failure = findFirstFailurePipelineNode(nodes);
    if (failure && !firstFailure) {
      firstFailure = failure;
      failureNodeUrl = nodeUrl;
    }
    if (isJenkinsPipelineStillRunning(nodes)) {
      stillRunning = true;
    }
  }

  if (firstFailure) {
    upsertParentTaskParam(db, {
      id: randomUUID(),
      parent_task_id: parentTask.pid,
      param_key: DEV_OPS_DEPLOY_PARAM_KEY.TestEnvDeployResult,
      value_json: JSON.stringify({
        failureNode: firstFailure,
        nodeUrl: failureNodeUrl,
        nodeUrls,
        taskId: task.id,
        fetchedAt: t(),
      }),
      description: "测试环境 Jenkins 流水线首个 FAILURE 节点",
    });

    const reportDescription = buildTestEnvDeployFailureDescription(firstFailure);
    const maxRetry = getGlobalMaxRetryCount(db);
    const deployResultRunCount = countTestEnvDeployResultTasksUnderParent(db, parentTask.pid);
    if (deployResultRunCount <= maxRetry) {
      cloneTasksOnTestEnvDeployFailed(db, parentTask.pid, task.id, reportDescription);
    } else {
      log.info(
        { taskId: task.id, parentPid: parentTask.pid, deployResultRunCount, maxRetry },
        "test env deploy result: max retry count reached, skip clone",
      );
    }

    completeDeployResultTask(db, task.id, { fetchResults, failureNode: firstFailure, reportDescription });
    log.warn(
      { taskId: task.id, parentPid: parentTask.pid, nodeId: firstFailure.id, displayName: firstFailure.displayName },
      "test env deploy result: pipeline failure node found, cloned retry tasks",
    );
    return;
  }

  if (stillRunning) {
    const elapsed = t() - startedAt;
    if (elapsed < pollTimeoutMs) {
      const released = releaseClaimedTaskToPending(db, task.id);
      log.info(
        {
          taskId: task.id,
          parentPid: parentTask.pid,
          pollTimeoutMs,
          elapsedMs: elapsed,
          remainingMs: pollTimeoutMs - elapsed,
          released,
        },
        "test env deploy result: pipeline still running, released to pending",
      );
      return;
    }
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: `等待 Jenkins 流水线结束超时（${Math.round(pollTimeoutMs / 60_000)} 分钟）`,
      output_json: JSON.stringify({ fetchResults }),
    });
    log.warn({ taskId: task.id, parentPid: parentTask.pid, elapsedMs: elapsed }, "test env deploy result: poll timeout");
    return;
  }

  upsertParentTaskParam(db, {
    id: randomUUID(),
    parent_task_id: parentTask.pid,
    param_key: DEV_OPS_DEPLOY_PARAM_KEY.TestEnvDeployResult,
    value_json: JSON.stringify({
      failureNode: null,
      nodeUrls,
      taskId: task.id,
      fetchedAt: t(),
    }),
    description: "测试环境 Jenkins 流水线无 FAILURE 节点",
  });
  completeDeployResultTask(db, task.id, { fetchResults, failureNode: null });
  log.info({ taskId: task.id, parentPid: parentTask.pid }, "test env deploy result: no failure node");
}
