/** 写入 `tasks.meta_json`，供 `GET /api/tasks/:id/claude-agent-stream` 解析续订 */
export const TASK_META_CLAUDE_AGENT_RUN_ID = "claudeAgentRunId" as const;

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

export function mergeTaskMetaWithClaudeRunId(meta_json: string | null, runId: string): string {
  const meta = parseMetaObject(meta_json);
  meta[TASK_META_CLAUDE_AGENT_RUN_ID] = runId;
  return JSON.stringify(meta);
}

export function getClaudeAgentRunIdFromTaskMeta(meta_json: string | null): string | null {
  const meta = parseMetaObject(meta_json);
  const v = meta[TASK_META_CLAUDE_AGENT_RUN_ID];
  return typeof v === "string" && v.length > 0 ? v : null;
}
