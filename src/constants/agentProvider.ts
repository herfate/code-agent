/**
 * `threads` / `agent_runs.provider` 持久化字符串。
 */
export const AGENT_PROVIDER = {
  Claude: "claude",
  Codex: "codex",
  Cursor: "cursor",
} as const;

export type AgentProvider = (typeof AGENT_PROVIDER)[keyof typeof AGENT_PROVIDER];

const AGENT_PROVIDER_SET = new Set<string>(Object.values(AGENT_PROVIDER));

export function isAgentProvider(v: unknown): v is AgentProvider {
  return typeof v === "string" && AGENT_PROVIDER_SET.has(v);
}

/** 定时任务 / 父任务 `init.provider` 可用线路（不含 codex） */
export const TASK_RUN_AGENT_PROVIDER = {
  Claude: AGENT_PROVIDER.Claude,
  Cursor: AGENT_PROVIDER.Cursor,
} as const;

export type TaskAgentProvider = (typeof TASK_RUN_AGENT_PROVIDER)[keyof typeof TASK_RUN_AGENT_PROVIDER];

const TASK_RUN_AGENT_PROVIDER_SET = new Set<string>(Object.values(TASK_RUN_AGENT_PROVIDER));

export function isTaskAgentProvider(v: unknown): v is TaskAgentProvider {
  return typeof v === "string" && TASK_RUN_AGENT_PROVIDER_SET.has(v);
}

export function parseTaskAgentProviderOptional(raw: unknown): TaskAgentProvider | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const t = raw.trim().toLowerCase();
    if (t === "") return null;
    if (isTaskAgentProvider(t)) return t;
  }
  return null;
}

export function parseTaskAgentProvider(raw: unknown, fallback: TaskAgentProvider): TaskAgentProvider {
  return parseTaskAgentProviderOptional(raw) ?? fallback;
}

export function agentProviderLabel(code: AgentProvider | string): string {
  switch (code) {
    case AGENT_PROVIDER.Claude:
      return "Claude";
    case AGENT_PROVIDER.Codex:
      return "Codex";
    case AGENT_PROVIDER.Cursor:
      return "Cursor";
    default:
      return String(code);
  }
}

export function taskAgentProviderLabel(code: TaskAgentProvider | string): string {
  switch (code) {
    case TASK_RUN_AGENT_PROVIDER.Claude:
      return "Claude";
    case TASK_RUN_AGENT_PROVIDER.Cursor:
      return "Cursor";
    default:
      return String(code);
  }
}
