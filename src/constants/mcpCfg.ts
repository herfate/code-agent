import type { McpServerConfig } from "@cursor/sdk";
import { TASK_TYPE, type TaskType } from "./taskType.js";

/**
 * MCP 配置枚举：每个键对应一组 SDK `mcpServers`。
 * 修改 MCP 地址或任务映射时只改本文件。
 */
export const MCP_CFG_KEY = {
  /** 不注入 MCP */
  none: {} satisfies Record<string, McpServerConfig>,
  /** 开发/设计：TAPD */
  dev: {
    "mcp-tapd": {
      type: "sse",
      url: "https://mcp-api.tencent-cloud.com/sse/做配置化",
    },
  } satisfies Record<string, McpServerConfig>,
  /** 测试类： 后台mcp + Playwright */
  test: {
    "mcp-tp-remote": {
      type: "sse",
      url: "http://192.168.211.152:8080/sse",
    },
    playwright: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
    },
  } satisfies Record<string, McpServerConfig>,
  /** QA 脚本生成：后台mcp */
  qaScript: {
    "mcp-tp-remote": {
      type: "sse",
      url: "http://192.168.211.152:8080/sse",
    },
  } satisfies Record<string, McpServerConfig>,
} as const;

export type McpCfgKey = keyof typeof MCP_CFG_KEY;

/** `tasks.task_type` → MCP 配置档键名 */
export function getMcpCfgKeyByTaskType(taskType: TaskType): McpCfgKey {
  switch (taskType) {
    case TASK_TYPE.Design:
    case TASK_TYPE.Dev:
    case TASK_TYPE.DevSpecOptimize:
    case TASK_TYPE.CodeReview:
      return "dev";
    case TASK_TYPE.TestPreAnalysis:
    case TASK_TYPE.TestCaseDesign:
    case TASK_TYPE.TestDataAnalysis:
    case TASK_TYPE.TestCaseExecute:
      return "test";
    case TASK_TYPE.QaScriptGen:
      return "qaScript";
    default:
      return "none";
  }
}

/** 按配置档键名取 SDK `mcpServers`（`none` 返回 `undefined`） */
export function getMcpServersByCfgKey(key: McpCfgKey): Record<string, McpServerConfig> | undefined {
  const servers = MCP_CFG_KEY[key];
  return Object.keys(servers).length > 0 ? { ...servers } : undefined;
}

/** 按任务类型解析并返回 SDK `mcpServers` */
export function getMcpServersByTaskType(taskType: TaskType): Record<string, McpServerConfig> | undefined {
  return getMcpServersByCfgKey(getMcpCfgKeyByTaskType(taskType));
}
