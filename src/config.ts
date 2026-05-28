import "dotenv/config";
import { z } from "zod";
import { TASK_RUN_AGENT_PROVIDER } from "./constants/agentProvider.js";
import { zTaskAgentProviderEnum } from "./validation/agentProviderZod.js";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_PATH: z.string().default("./data/app.db"),
  /** 待执行任务（`tasks.status = 1`）扫描间隔（毫秒）；`0` 或未设置表示关闭 */
  TASK_SCAN_INTERVAL_MS: z.coerce.number().int().min(0).default(30000),
  /** 每轮扫描最多拉取的状态为待执行（1）的任务数（1–500） */
  TASK_SCAN_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  CURSOR_API_KEY: z.string().optional(),
  /** 定时任务认领后使用的 Agent provider（见 {@link TASK_RUN_AGENT_PROVIDER}） */
  TASK_AGENT_PROVIDER: zTaskAgentProviderEnum.default(TASK_RUN_AGENT_PROVIDER.Claude),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
