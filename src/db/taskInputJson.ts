import type { TaskRow } from "./workflow.js";

/** 与 POST /api/tasks 写入的 `tasks.input_json` 对齐的可选字段 */
export type TaskInputJson = {
  app?: string;
  branch_version?: string;
  requirement?: string;
  gitRemoteUrl?: string;
  testEnv?: string;
};

/** 将 {@link TaskRow.input_json} 反序列化为结构化对象；空串、非法 JSON、非对象时返回 `{}` */
export function parseTaskInputJson(inputJson: string | null): TaskInputJson {
  if (!inputJson?.trim()) return {};
  try {
    const raw = JSON.parse(inputJson) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const o = raw as Record<string, unknown>;
    const str = (key: string): string | undefined => {
      const v = o[key];
      return typeof v === "string" ? v.trim() || undefined : undefined;
    };
    return {
      app: str("app"),
      branch_version: str("branch_version"),
      requirement: str("requirement"),
      gitRemoteUrl: str("gitRemoteUrl"),
      testEnv: str("testEnv"),
    };
  } catch {
    return {};
  }
}
