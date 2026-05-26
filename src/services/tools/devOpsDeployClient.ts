import type { DatabaseSync } from "node:sqlite";
import { DEV_OPS_DEPLOY_URL_CONFIG_KEY } from "../../constants/systemConfigKeys.js";
import { getGlobalConfigByKey } from "../../db/systemConfig.js";
import { parseConfigStringValue } from "../dbConfig.js";

export type DevOpsDeployParams = {
  gitBranch: string;
  serverName: string;
  /** 测试环境标识（如 it01），发布前 PUT 绑定 pipeline 与应用 */
  env: string;
};

export type DevOpsDeployResult = {
  ok: boolean;
  status: number;
  body: string;
};

export type DevOpsDeployOptions = {
  /** 部署 HTTP 成功后的额外等待（毫秒），用于同父任务多应用顺序部署时错开流水线 */
  postSuccessDelayMs?: number;
};

const POST_DEPLOY_SLEEP_MS_MULTIPLE_DEPLOYS = 5 * 60 * 1000;

export { POST_DEPLOY_SLEEP_MS_MULTIPLE_DEPLOYS };

/** product_repos_api 单条记录（与 Java `Data_list` 字段对齐） */
type DevOpsReposItem = {
  iteration_id: string;
  br_name: string;
};

type DevOpsReposResponse = {
  data?: {
    data_list?: DevOpsReposItem[];
  };
};

/** PUT pipeline 环境套绑定响应 */
type DevOpsPipelineBindResponse = {
  status?: string;
  msg?: string;
};

const FETCH_TIMEOUT_MS = 120_000;

function fail(status: number, body: string): DevOpsDeployResult {
  return { ok: false, status, body };
}

/** 部署接口基址：环境变量优先，其次全局 `system_config.dev_ops_deploy_url`（如 `http://appdeploy.intelnal.howbuy.com`） */
export function resolveDevOpsDeployUrl(db: DatabaseSync): string | undefined {
  const fromEnv = process.env.DEV_OPS_DEPLOY_URL?.trim();
  if (fromEnv) return fromEnv;

  const row = getGlobalConfigByKey(db, DEV_OPS_DEPLOY_URL_CONFIG_KEY);
  if (!row) return undefined;
  const url = parseConfigStringValue(row.value_json).trim();
  return url || undefined;
}

/**
 * 测试环境部署（对齐 Java `dev_ops_deploy` / MCP `dev_ops_deploy`）：
 * 1. 按 app_name 查 product_repos_api 校验 serverName 并解析 tag
 * 2. PUT 绑定应用与测试环境（`pipeline_id` / `app_name` / `env`）
 * 3. 向 iter_mgt/pipeline 提交表单触发流水线
 */
export async function devOpsDeployTestEnv(
  baseUrl: string,
  params: DevOpsDeployParams,
  options?: DevOpsDeployOptions,
): Promise<DevOpsDeployResult> {
  const gitBranch = params.gitBranch?.trim() ?? "";
  const serverName = params.serverName?.trim() ?? "";
  const env = params.env?.trim() ?? "";

  if (!gitBranch) {
    return fail(0, "部署失败，代码分支版本必传");
  }
  if (!serverName) {
    return fail(0, "部署失败，应用/模块名称必传");
  }
  if (!env) {
    return fail(0, "部署失败，测试环境 env 必传");
  }

  const base = baseUrl.replace(/\/$/, "");
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  const pageData = encodeURIComponent(
    JSON.stringify({ pageNum: 1, pageSize: 10, pageTotal: 0 }),
  );
  const reposUrl =
    `${base}/spider/iter_mgt/product_repos_api?status=close` +
    `&page_data=${pageData}&app_name=${encodeURIComponent(serverName)}`;

  console.log("[devOpsDeployTestEnv] reposUrl:", reposUrl);
  const reposRes = await fetch(reposUrl, { signal });
  const reposBody = await reposRes.text();
  if (!reposRes.ok) {
    return fail(reposRes.status, reposBody);
  }

  let reposJson: DevOpsReposResponse;
  try {
    reposJson = JSON.parse(reposBody) as DevOpsReposResponse;
  } catch {
    return fail(reposRes.status, `解析应用信息失败: ${reposBody.slice(0, 500)}`);
  }
  console.log("[devOpsDeployTestEnv] reposJson:", reposJson)
  const dataList = reposJson.data?.data_list ?? [];
  if (dataList.length === 0) {
    return fail(0, "部署失败，应用/模块名称错误");
  }

  const first = dataList[0]!;
  const tag = first.iteration_id.replace(first.br_name, "");
  const pipelineId = `${tag}${gitBranch}`;
  const jobName = `${pipelineId}_${serverName}`;

  const bindBody = JSON.stringify({
    pipeline_id: pipelineId,
    app_name: serverName,
    env,
  });
  console.log("[devOpsDeployTestEnv] bind pipeline:", bindBody);
  const bindRes = await fetch(`${base}/spider/iter_mgt/pipeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: bindBody,
    signal,
  });
  const bindText = await bindRes.text();
  if (!bindRes.ok) {
    return fail(bindRes.status, `环境绑定失败 HTTP ${bindRes.status}: ${bindText.slice(0, 500)}`);
  }
  let bindJson: DevOpsPipelineBindResponse;
  try {
    bindJson = JSON.parse(bindText) as DevOpsPipelineBindResponse;
  } catch {
    return fail(bindRes.status, `解析环境绑定响应失败: ${bindText.slice(0, 500)}`);
  }
  if (bindJson.status !== "success") {
    const msg = bindJson.msg?.trim() || bindText.slice(0, 500);
    return fail(bindRes.status, `环境绑定失败: ${msg}`);
  }

  const form = new URLSearchParams();
  form.set("job_name", jobName);
  form.set("skip", "0");
  form.set("is_junit", "false");
  form.set("is_mock_agent", "0");
  form.set("biz_base_db", "0");
  form.set("db_exec_type", "increment");

  const pipelineRes = await fetch(`${base}/spider/iter_mgt/pipeline`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal,
  });
  const body = await pipelineRes.text();
  const result: DevOpsDeployResult = { ok: pipelineRes.ok, status: pipelineRes.status, body };

  const delayMs = options?.postSuccessDelayMs ?? 0;
  if (result.ok && delayMs > 0) {
    console.log(`[devOpsDeployTestEnv] post-deploy sleep ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return result;
}
