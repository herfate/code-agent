import type { DatabaseSync } from "node:sqlite";
import { DEV_OPS_DEPLOY_URL_CONFIG_KEY } from "../../constants/systemConfigKeys.js";
import { getGlobalConfigByKey } from "../../db/systemConfig.js";
import { parseConfigStringValue } from "../dbConfig.js";

export type DevOpsDeployParams = {
  gitBranch: string;
  serverName: string;
};

export type DevOpsDeployResult = {
  ok: boolean;
  status: number;
  body: string;
};

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
 * 2. 向 iter_mgt/pipeline 提交表单触发流水线
 */
export async function devOpsDeployTestEnv(
  baseUrl: string,
  params: DevOpsDeployParams,
): Promise<DevOpsDeployResult> {
  const gitBranch = params.gitBranch?.trim() ?? "";
  const serverName = params.serverName?.trim() ?? "";

  if (!gitBranch) {
    return fail(0, "部署失败，代码分支版本必传");
  }
  if (!serverName) {
    return fail(0, "部署失败，应用/模块名称必传");
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
  const jobName = `${tag}${gitBranch}_${serverName}`;

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
  return { ok: pipelineRes.ok, status: pipelineRes.status, body };
}
