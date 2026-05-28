import { TASK_RUN_AGENT_PROVIDER, type TaskAgentProvider } from "../constants/agentProvider.js";

export type { TaskAgentProvider } from "../constants/agentProvider.js";

/** Claude 任务 SSE 续订字段 */
export const TASK_META_CLAUDE_AGENT_RUN_ID = "claudeAgentRunId" as const;
/** Cursor 任务 SSE 续订字段 */
export const TASK_META_CURSOR_AGENT_RUN_ID = "cursorAgentRunId" as const;

const META_KEY_BY_PROVIDER: Record<TaskAgentProvider, string> = {
  [TASK_RUN_AGENT_PROVIDER.Claude]: TASK_META_CLAUDE_AGENT_RUN_ID,
  [TASK_RUN_AGENT_PROVIDER.Cursor]: TASK_META_CURSOR_AGENT_RUN_ID,
};

function parseMetaObject(meta_json: string | null): Record<string, unknown> {
  if (!meta_json || !meta_json.trim()) return {};
  try {
    const v: unknown = JSON.parse(meta_json);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

/** 写入任务 meta 中对应 provider 的 agent run id */
export function mergeTaskMetaWithAgentRunId(
  meta_json: string | null,
  provider: TaskAgentProvider,
  runId: string,
): string {
  const meta = parseMetaObject(meta_json);
  meta[META_KEY_BY_PROVIDER[provider]] = runId;
  return JSON.stringify(meta);
}

export function getAgentRunIdFromTaskMeta(
  meta_json: string | null,
  provider: TaskAgentProvider,
): string | null {
  const meta = parseMetaObject(meta_json);
  const v = meta[META_KEY_BY_PROVIDER[provider]];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 重置为待执行时移除 agent run 引用，避免 SSE 续订到上一轮 */
export function stripAgentRunIdsFromTaskMeta(meta_json: string | null): string | null {
  const meta = parseMetaObject(meta_json);
  delete meta[TASK_META_CLAUDE_AGENT_RUN_ID];
  delete meta[TASK_META_CURSOR_AGENT_RUN_ID];
  const keys = Object.keys(meta);
  if (keys.length === 0) return null;
  return JSON.stringify(meta);
}

/** @deprecated 使用 mergeTaskMetaWithAgentRunId */
export function mergeTaskMetaWithClaudeRunId(meta_json: string | null, runId: string): string {
  return mergeTaskMetaWithAgentRunId(meta_json, TASK_RUN_AGENT_PROVIDER.Claude, runId);
}

/** @deprecated 使用 getAgentRunIdFromTaskMeta */
export function getClaudeAgentRunIdFromTaskMeta(meta_json: string | null): string | null {
  return getAgentRunIdFromTaskMeta(meta_json, TASK_RUN_AGENT_PROVIDER.Claude);
}

/** @deprecated 使用 stripAgentRunIdsFromTaskMeta */
export function stripClaudeAgentRunIdFromTaskMeta(meta_json: string | null): string | null {
  return stripAgentRunIdsFromTaskMeta(meta_json);
}

export function getCursorAgentRunIdFromTaskMeta(meta_json: string | null): string | null {
  return getAgentRunIdFromTaskMeta(meta_json, TASK_RUN_AGENT_PROVIDER.Cursor);
}
