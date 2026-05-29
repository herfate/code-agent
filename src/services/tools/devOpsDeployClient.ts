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

/** Jenkins Blue Ocean pipeline 详情页模板（`${job_name}`、`${build_number}` 占位替换） */
export const JENKINS_PIPELINE_RESULT_URL_TEMPLATE =
  "http://jkp-s1.howbuy.pa/jenkins/blue/organizations/jenkins/${job_name}/detail/${job_name}/${build_number}/pipeline/";

/** Jenkins Blue Ocean pipeline 节点列表 REST 模板（`${job_name}`、`${build_number}` 占位替换） */
export const JENKINS_PIPELINE_NODE_URL_TEMPLATE =
  "http://jkp-s1.howbuy.pa/jenkins/blue/rest/organizations/jenkins/pipelines/${job_name}/runs/${build_number}/nodes/?limit=10000";

/** DevOps pipeline 触发响应中单条 job 记录（API 原始字段） */
export type DevOpsDeployPipelineItemRaw = {
  job_name: string;
  result: string;
  msg: string;
  build_number: number;
  job_url: string;
};

/** 落库用：在原始字段上附加拼接后的 `result_url`、`node_url` */
export type DevOpsDeployPipelineItem = DevOpsDeployPipelineItemRaw & {
  result_url: string;
  node_url: string;
};

export type DevOpsDeployPipelineResponse = {
  status: string;
  data: DevOpsDeployPipelineItem[];
  msg: string;
};

export type DevOpsDeployResult = {
  ok: boolean;
  status: number;
  body: string;
  /** HTTP 成功且 body 可解析时填充 */
  parsed?: DevOpsDeployPipelineResponse;
};

/** API 返回的 build_number 与 Jenkins 展示/REST 用的 run 号差 1 */
function jenkinsRunNumber(buildNumber: number): string {
  return String(buildNumber + 1);
}

/** 按模板拼接 Jenkins pipeline 详情地址 */
export function buildJenkinsPipelineResultUrl(jobName: string, buildNumber: number): string {
  return JENKINS_PIPELINE_RESULT_URL_TEMPLATE.replace(/\$\{job_name\}/g, jobName).replace(
    /\$\{build_number\}/g,
    jenkinsRunNumber(buildNumber),
  );
}

/** 按模板拼接 Jenkins pipeline 节点列表 REST 地址 */
export function buildJenkinsPipelineNodeUrl(jobName: string, buildNumber: number): string {
  return JENKINS_PIPELINE_NODE_URL_TEMPLATE.replace(/\$\{job_name\}/g, jobName).replace(
    /\$\{build_number\}/g,
    jenkinsRunNumber(buildNumber),
  );
}

/** 解析 pipeline POST 响应，并为每条 data 附加 `result_url`、`node_url` */
export function parseDevOpsDeployPipelineResponse(body: string): DevOpsDeployPipelineResponse | null {
  try {
    const raw = JSON.parse(body) as {
      status?: unknown;
      data?: unknown;
      msg?: unknown;
    };
    if (typeof raw.status !== "string" || !Array.isArray(raw.data)) return null;

    const data: DevOpsDeployPipelineItem[] = raw.data.map((item) => {
      const row = item as Partial<DevOpsDeployPipelineItemRaw>;
      const jobName = String(row.job_name ?? "");
      const buildNumber = Number(row.build_number ?? 0);
      return {
        job_name: jobName,
        result: String(row.result ?? ""),
        msg: String(row.msg ?? ""),
        build_number: buildNumber,
        job_url: String(row.job_url ?? ""),
        result_url: buildJenkinsPipelineResultUrl(jobName, buildNumber),
        node_url: buildJenkinsPipelineNodeUrl(jobName, buildNumber),
      };
    });

    return {
      status: raw.status,
      data,
      msg: typeof raw.msg === "string" ? raw.msg : "",
    };
  } catch {
    return null;
  }
}

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

/** Jenkins Blue Ocean pipeline 单节点（REST `/nodes/` 数组元素） */
export type JenkinsPipelineNode = {
  _class?: string;
  displayName?: string | null;
  displayDescription?: string | null;
  durationInMillis?: number;
  id?: string;
  result?: string | null;
  startTime?: string;
  state?: string;
  type?: string;
  [key: string]: unknown;
};

export type FetchJenkinsPipelineNodesResult = {
  ok: boolean;
  status: number;
  body: string;
  nodes?: JenkinsPipelineNode[];
};

/** 从 `DevOpsDeployResult` 落库 JSON 提取各 job 的 `node_url` */
export function extractNodeUrlsFromDevOpsDeployResult(valueJson: string): string[] {
  try {
    const raw = JSON.parse(valueJson) as { data?: unknown };
    if (!Array.isArray(raw.data)) return [];
    const urls: string[] = [];
    for (const item of raw.data) {
      const nodeUrl = (item as { node_url?: unknown }).node_url;
      if (typeof nodeUrl === "string" && nodeUrl.trim()) urls.push(nodeUrl.trim());
    }
    return urls;
  } catch {
    return [];
  }
}

/** GET Jenkins pipeline 节点列表 */
export async function fetchJenkinsPipelineNodes(nodeUrl: string): Promise<FetchJenkinsPipelineNodesResult> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(nodeUrl, { signal });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, status: res.status, body: "Jenkins 节点响应不是 JSON 数组" };
    }
    return { ok: true, status: res.status, body, nodes: parsed as JenkinsPipelineNode[] };
  } catch {
    return { ok: false, status: res.status, body: `解析 Jenkins 节点列表失败: ${body.slice(0, 500)}` };
  }
}

/** 取数组中第一个 `result === FAILURE` 的节点（大小写不敏感） */
export function findFirstFailurePipelineNode(
  nodes: JenkinsPipelineNode[],
): JenkinsPipelineNode | undefined {
  return nodes.find((n) => String(n.result ?? "").toUpperCase() === "FAILURE");
}

/** 是否仍有节点未结束（流水线可能仍在运行） */
export function isJenkinsPipelineStillRunning(nodes: JenkinsPipelineNode[]): boolean {
  if (nodes.length === 0) return true;
  return nodes.some((n) => {
    const state = String(n.state ?? "").toUpperCase();
    return state !== "FINISHED" && state !== "SKIPPED";
  });
}

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
  const parsed = parseDevOpsDeployPipelineResponse(body);
  return { ok: pipelineRes.ok, status: pipelineRes.status, body, parsed: parsed ?? undefined };
}
