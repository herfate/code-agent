import type { DatabaseSync } from "node:sqlite";
import {
  MAX_RETRY_COUNT_CONFIG_KEY,
  QA_CONFIG_KEY_PASSWORD,
  QA_CONFIG_KEY_USERNAME,
} from "../constants/systemConfigKeys.js";
import {
  getGlobalConfigByKey,
  resolveConfigByKey,
  type ConfigScope,
  type SystemConfigRow,
} from "../db/systemConfig.js";

// --- 通用：全局 system_config 的 value_json 解析 ---

/** 将 `value_json` 解析为字符串（支持 JSON 编码的 `"xxx"` 或裸文本） */
export function parseConfigStringValue(valueJson: string): string {
  const t = valueJson.trim();
  if (!t) return "";
  try {
    const v = JSON.parse(valueJson) as unknown;
    if (typeof v === "string") return v;
  } catch {
    /* 非 JSON 则整段作为字面值 */
  }
  return t;
}

/** 将 `value_json` 解析为非负整数；无法解析时返回 `null` */
export function parseConfigIntValue(valueJson: string): number | null {
  const t = valueJson.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(valueJson) as unknown;
    if (typeof v === "number" && Number.isFinite(v)) {
      const n = Math.trunc(v);
      return n >= 0 ? n : null;
    }
    if (typeof v === "string") {
      const n = Number(v.trim());
      if (Number.isInteger(n) && n >= 0) return n;
    }
  } catch {
    const n = Number(t);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return null;
}

/** 全局最大重试次数（`max_retry_count`）；未配置或非法时默认 `3` */
export const DEFAULT_MAX_RETRY_COUNT = 3;

export function getGlobalMaxRetryCount(db: DatabaseSync): number {
  const row = getGlobalConfigByKey(db, MAX_RETRY_COUNT_CONFIG_KEY);
  if (!row) return DEFAULT_MAX_RETRY_COUNT;
  const n = parseConfigIntValue(row.value_json);
  return n !== null ? n : DEFAULT_MAX_RETRY_COUNT;
}

/**
 * 按 `config_key` 读取 `system_config` 并解析为字符串：先匹配用户行，若无则全局行（与 {@link resolveConfigByKey} 一致）。
 * `username` 为空或仅空白时只查全局。
 */
export type ResolvedConfigString = {
  /** 解析后的字符串（未再 trim；需要时请自行 `.trim()`） */
  value: string;
  /** 实际命中的是用户配置还是全局回退 */
  source: ConfigScope;
  row: SystemConfigRow;
};

export function getResolvedConfigString(
  db: DatabaseSync,
  username: string | null | undefined,
  configKey: string,
): ResolvedConfigString | undefined {
  const hit = resolveConfigByKey(db, username, configKey);
  if (!hit) return undefined;
  return {
    value: parseConfigStringValue(hit.row.value_json),
    source: hit.source,
    row: hit.row,
  };
}

// --- QA：键名与读表 ---

/** 与 Java 版一致，固定 QA 站点根地址 */
export const QA_PLATFORM_BASE_URL = "http://qa.howbuy.pa";

export type QaProxyCredentials = {
  baseUrl: string;
  userName: string;
  passWord: string;
};

export function getQaCredentials(db: DatabaseSync): QaProxyCredentials | null {
  const userRow = getGlobalConfigByKey(db, QA_CONFIG_KEY_USERNAME);
  const passRow = getGlobalConfigByKey(db, QA_CONFIG_KEY_PASSWORD);
  const userName = userRow ? parseConfigStringValue(userRow.value_json).trim() : "";
  const passWord = passRow ? parseConfigStringValue(passRow.value_json) : "";
  if (!userName || passWord === "") return null;
  return { baseUrl: QA_PLATFORM_BASE_URL.replace(/\/+$/, ""), userName, passWord };
}
