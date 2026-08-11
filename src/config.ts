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
  TASK_SCAN_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(5),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  CURSOR_API_KEY: z.string().optional(),
  /** 定时任务认领后使用的 Agent provider（见 {@link TASK_RUN_AGENT_PROVIDER}） */
  TASK_AGENT_PROVIDER: zTaskAgentProviderEnum.default(TASK_RUN_AGENT_PROVIDER.Claude),
  /** 每日 Wiki Confluence 同步时刻（本地时区小时 0–23）；`-1` 表示关闭；同刻同步代码库到 code_base */
  WIKI_SYNC_DAILY_HOUR: z.coerce.number().int().min(-1).max(23).default(1),
  /** 每日 Wiki 同步分钟（0–59） */
  WIKI_SYNC_DAILY_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  /**
   * Confluence 同步成功后是否定时自动创建知识沉淀父任务（类型 7）；
   * 默认关闭；设为 `true` / `1` 开启
   */
  WIKI_SYNC_CREATE_PERSIST_MEMORY: z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return false;
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "1";
  }, z.boolean()),
  /** Wiki 智能问答是否允许选择 Cursor 线路；`false` 时前端禁用 Cursor 并提示 */
  WIKI_QA_CURSOR_ENABLED: z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return true;
    const s = String(v).trim().toLowerCase();
    return !(s === "false" || s === "0");
  }, z.boolean()),
  /** Wiki 智能问答禁用 Cursor 时展示的提示文案 */
  WIKI_QA_CURSOR_DISABLED_REASON: z.string().default("cursor没钱了等下周一开放"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
