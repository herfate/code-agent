/**
 * DevOps 申请拉取分支 HTTP 客户端（对齐 Java `iter_apply_api` / MCP 同名能力）。
 * 认证：`POST /spider/user/login/` 用 `username`/`password` 换取 SimpleJWT access token，
 * 再以 `Authorization: Bearer <access>` 调用 `iter_apply_api`（token 缓存 ~11h，401/403 自动刷新一次）。
 * 请求体字段保持与 API 一致的 snake_case 直接透传，由调用方组装。
 */

/** `repos_str` 单条记录：`${gitlab_group}/${repo}` 形态的仓库路径与部署模块名 */
export type DevOpsBranchApplyReposItem = {
  repos_path: string;
  module_name: string;
};

/** POST `/spider/iter_mgt/iter_apply_api` 请求体（字段名与接口一一对应） */
export type DevOpsBranchApplyPayload = {
  /** 申请截止时间（ISO 字符串，如 `2026-07-24T06:47:09.400Z`） */
  deadline?: string;
  desc: string;
  gitlab_group: string;
  repos_str: DevOpsBranchApplyReposItem[];
  /** 分支类型（如 `bugfix`、`feature`） */
  branch_type: string;
  /** 是否更新外部依赖（`"0"` / `"1"`） */
  is_update_out_dep: string;
  branch_name: string;
  /** TAPD 任务 ID，可不传 */
  tapd_id?: string;
};

/** 接口响应体 */
export type DevOpsBranchApplyResponse = {
  status: string;
  data: { sid: number };
  msg: string;
};

export type DevOpsBranchApplyResult = {
  ok: boolean;
  status: number;
  body: string;
  /** HTTP 成功且 body 可解析时填充 */
  parsed?: DevOpsBranchApplyResponse;
};

const FETCH_TIMEOUT_MS = 120_000;
const LOGIN_TIMEOUT_MS = 10_000;
/** access token 有效期约 12h，缓存 11h 留余量 */
const TOKEN_TTL_MS = 11 * 60 * 60 * 1000;

let tokenCache: { token: string; fetchedAt: number; credKey: string } | null = null;

/** 失效缓存的 access token（下次请求重新登录） */
export function invalidateDevOpsBranchApplyTokenCache(): void {
  tokenCache = null;
}

function credKeyOf(userName: string, passWord: string): string {
  return `${userName}\0${passWord}`;
}

/** `POST /spider/user/login/` 换取 SimpleJWT access token */
async function loginDevOpsAccess(
  baseUrl: string,
  userName: string,
  passWord: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/spider/user/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: userName, password: passWord }),
    signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DevOps login HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`DevOps login 非 JSON 响应: ${text.slice(0, 240)}`);
  }
  const access = (json as { access?: unknown }).access;
  if (typeof access !== "string" || access.length === 0) {
    throw new Error(`DevOps login 返回无 access token: ${text.slice(0, 240)}`);
  }
  return access;
}

/** 带缓存获取 access token（凭据变化或过期则重新登录） */
async function getDevOpsAccessToken(
  baseUrl: string,
  userName: string,
  passWord: string,
): Promise<string> {
  const key = credKeyOf(userName, passWord);
  if (tokenCache && tokenCache.credKey === key && Date.now() - tokenCache.fetchedAt < TOKEN_TTL_MS) {
    return tokenCache.token;
  }
  const token = await loginDevOpsAccess(baseUrl, userName, passWord);
  tokenCache = { token, fetchedAt: Date.now(), credKey: key };
  return token;
}

function fail(status: number, body: string): DevOpsBranchApplyResult {
  return { ok: false, status, body };
}

async function postIterApply(
  base: string,
  payload: DevOpsBranchApplyPayload,
  token: string,
): Promise<Response> {
  payload.tapd_id = ''
  return fetch(`${base}/spider/iter_mgt/iter_apply_api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/**
 * 申请拉取分支（`POST ${base}/spider/iter_mgt/iter_apply_api`）。
 * 用 `userName`/`passWord` 登录换取 access token，再以 Bearer 提交（401/403 自动刷新一次）。
 * 仅校验 `gitlab_group`、`branch_name`、`repos_str` 非空，其余字段原样提交。
 */
export async function devOpsBranchApply(
  baseUrl: string,
  payload: DevOpsBranchApplyPayload,
  userName: string,
  passWord: string,
): Promise<DevOpsBranchApplyResult> {
  const gitlabGroup = payload.gitlab_group?.trim() ?? "";
  const branchName = payload.branch_name?.trim() ?? "";
  const reposStr = payload.repos_str ?? [];
  const user = userName?.trim() ?? "";

  if (!gitlabGroup) {
    return fail(0, "申请拉取分支失败，gitlab_group 必传");
  }
  if (!branchName) {
    return fail(0, "申请拉取分支失败，branch_name 必传");
  }
  if (!Array.isArray(reposStr) || reposStr.length === 0) {
    return fail(0, "申请拉取分支失败，repos_str 不能为空");
  }
  if (!user || !passWord) {
    return fail(0, "申请拉取分支失败，未配置认证凭据（qa_platform_username / qa_platform_password）");
  }

  const base = baseUrl.replace(/\/$/, "");

  let token: string;
  try {
    token = await getDevOpsAccessToken(base, user, passWord);
  } catch (e) {
    return fail(0, e instanceof Error ? e.message : String(e));
  }

  let res = await postIterApply(base, payload, token);
  // access token 可能已过期：401/403 时刷新一次重试
  if (res.status === 401 || res.status === 403) {
    invalidateDevOpsBranchApplyTokenCache();
    try {
      token = await getDevOpsAccessToken(base, user, passWord);
    } catch (e) {
      return fail(0, e instanceof Error ? e.message : String(e));
    }
    res = await postIterApply(base, payload, token);
  }
  const body = await res.text();
  if (!res.ok) return fail(res.status, body);

  let parsed: DevOpsBranchApplyResponse | undefined;
  try {
    const raw = JSON.parse(body) as Partial<DevOpsBranchApplyResponse>;
    if (typeof raw.status === "string") {
      parsed = {
        status: raw.status,
        msg: typeof raw.msg === "string" ? raw.msg : "",
        data: { sid: Number(raw.data?.sid ?? 0) },
      };
    }
  } catch {
    parsed = undefined;
  }

  return { ok: res.ok, status: res.status, body, parsed };
}
