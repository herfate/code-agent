import { z } from "zod";
import {
  AGENT_PROVIDER,
  isAgentProvider,
  isTaskAgentProvider,
  TASK_RUN_AGENT_PROVIDER,
  type AgentProvider,
  type TaskAgentProvider,
} from "../constants/agentProvider.js";

const agentProviderValues = [
  AGENT_PROVIDER.Claude,
  AGENT_PROVIDER.Codex,
  AGENT_PROVIDER.Cursor,
] as const;

const taskRunAgentProviderValues = [
  TASK_RUN_AGENT_PROVIDER.Claude,
  TASK_RUN_AGENT_PROVIDER.Cursor,
] as const;

export const zAgentProvider = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v): v is AgentProvider => isAgentProvider(v), {
    message: "invalid provider (expected claude, codex, or cursor)",
  });

export const zAgentProviderOptional = zAgentProvider.optional();

export const zTaskAgentProvider = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v): v is TaskAgentProvider => isTaskAgentProvider(v), {
    message: "invalid provider (expected claude or cursor)",
  });

export const zTaskAgentProviderOptional = zTaskAgentProvider.optional();

/** 与 `z.enum([...])` 等价，值来自 {@link AGENT_PROVIDER} */
export const zAgentProviderEnum = z.enum(agentProviderValues);

export const zAgentProviderEnumOptional = zAgentProviderEnum.optional();

export const zTaskAgentProviderEnum = z.enum(taskRunAgentProviderValues);

export const zTaskAgentProviderEnumOptional = zTaskAgentProviderEnum.optional();
