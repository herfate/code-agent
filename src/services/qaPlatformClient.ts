import type { DatabaseSync } from "node:sqlite";
import { getGlobalConfigByKey } from "../db/systemConfig.js";

/** 与 Java 版一致，固定 QA 站点根地址 */
export const QA_PLATFORM_BASE_URL = "http://qa.howbuy.pa";

/** 全局 `system_config.config_key`，`value_json` 为 JSON 字符串或裸文本 */
export const QA_CONFIG_KEY_USERNAME = "qa_platform_username";
export const QA_CONFIG_KEY_PASSWORD = "qa_platform_password";

export type QaProxyCredentials = {
  baseUrl: string;
  userName: string;
  passWord: string;
};

const ACCEPT = "application/json, text/javascript, */*";
const TOKEN_TTL_MS = 25 * 60 * 1000;

let tokenCache: { token: string; fetchedAt: number; credKey: string } | null = null;

function credKey(creds: QaProxyCredentials): string {
  return `${creds.userName}\0${creds.passWord}`;
}

export function invalidateQaTokenCache(): void {
  tokenCache = null;
}

/** 将 `value_json` 解析为字符串（支持 JSON 编码的 `"xxx"` 或裸文本） */
function parseConfigStringValue(valueJson: string): string {
  const t = valueJson.trim();
  if (!t) return "";
  try {
    const v = JSON.parse(t) as unknown;
    if (typeof v === "string") return v;
  } catch {
    /* 非 JSON 则整段作为字面值 */
  }
  return t;
}

export function getQaCredentials(db: DatabaseSync): QaProxyCredentials | null {
  const userRow = getGlobalConfigByKey(db, QA_CONFIG_KEY_USERNAME);
  const passRow = getGlobalConfigByKey(db, QA_CONFIG_KEY_PASSWORD);
  const userName = userRow ? parseConfigStringValue(userRow.value_json).trim() : "";
  const passWord = passRow ? parseConfigStringValue(passRow.value_json) : "";
  if (!userName || passWord === "") return null;
  return { baseUrl: QA_PLATFORM_BASE_URL.replace(/\/+$/, ""), userName, passWord };
}

function joinPath(base: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function login(creds: QaProxyCredentials): Promise<string> {
  const url = joinPath(creds.baseUrl, "/qa-info/login");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: ACCEPT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userName: creds.userName, passWord: creds.passWord }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`QA login HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as { data?: unknown };
  } catch {
    throw new Error(`QA login 非 JSON 响应: ${text.slice(0, 240)}`);
  }
  const data = (json as { data?: unknown }).data;
  if (typeof data !== "string" || data.length === 0) {
    throw new Error(`QA login 返回无有效 token: ${text.slice(0, 240)}`);
  }
  return data;
}

async function getToken(creds: QaProxyCredentials): Promise<string> {
  const key = credKey(creds);
  if (
    tokenCache &&
    tokenCache.credKey === key &&
    Date.now() - tokenCache.fetchedAt < TOKEN_TTL_MS
  ) {
    return tokenCache.token;
  }
  const token = await login(creds);
  tokenCache = { token, fetchedAt: Date.now(), credKey: key };
  return token;
}

async function authorizedFetch(
  creds: QaProxyCredentials,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let token = await getToken(creds);
  const headers = new Headers(init.headers);
  headers.set("Accept", ACCEPT);
  headers.set("X-Token", token);
  let res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(10_000) });
  if (res.status === 401 || res.status === 403) {
    invalidateQaTokenCache();
    token = await getToken(creds);
    headers.set("X-Token", token);
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(10_000) });
  }
  return res;
}

/** 对应 Java getUrl：解析响应 JSON 并取 `data` 字段 */
export async function qaGetData(creds: QaProxyCredentials, pathWithQuery: string): Promise<unknown> {
  const url = pathWithQuery.startsWith("http") ? pathWithQuery : joinPath(creds.baseUrl, pathWithQuery);
  const res = await authorizedFetch(creds, url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`QA GET HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`QA GET 非 JSON: ${text.slice(0, 300)}`);
  }
  if (typeof json !== "object" || json === null || !("data" in json)) {
    throw new Error(`QA GET 响应无 data: ${text.slice(0, 300)}`);
  }
  return (json as { data: unknown }).data;
}

/** 对应 Java postRawUrl：返回下游原始 body 字符串 */
export async function qaPostRaw(
  creds: QaProxyCredentials,
  path: string,
  bodyJson: string,
): Promise<string> {
  const url = path.startsWith("http") ? path : joinPath(creds.baseUrl, path);
  const res = await authorizedFetch(creds, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyJson,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`QA POST HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text;
}
