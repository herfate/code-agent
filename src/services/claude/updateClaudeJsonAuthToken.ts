import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyBaseLogger } from "fastify";
import { resolveAnthropicAuthToken } from "../dbConfig.js";

/** 默认 Claude Code 用户配置路径（`env.ANTHROPIC_AUTH_TOKEN` 在此生效） */
export function defaultClaudeJsonPath(): string {
  return path.join(homedir(), ".claude", "settings.json");
}

/**
 * 将 Bearer Token 写入 `~/.claude.json` 的 `env.ANTHROPIC_AUTH_TOKEN`。
 * 文件不存在时会创建最小结构；已有 `env` 时仅覆盖该字段。
 */
export function updateClaudeJsonAuthToken(authToken: string, claudeJsonPath = defaultClaudeJsonPath()): void {
  const token = authToken.trim();
  if (!token) throw new Error("authToken 不能为空");

  let doc: Record<string, unknown> = {};
  if (existsSync(claudeJsonPath)) {
    const raw = readFileSync(claudeJsonPath, "utf8");
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        doc = parsed as Record<string, unknown>;
      } else {
        throw new Error("根节点须为 JSON 对象");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`解析 ${claudeJsonPath} 失败: ${message}`);
    }
  }

  const prevEnv = doc.env;
  const env =
    prevEnv && typeof prevEnv === "object" && !Array.isArray(prevEnv)
      ? { ...(prevEnv as Record<string, unknown>) }
      : {};
  env.ANTHROPIC_AUTH_TOKEN = token;
  doc.env = env;

  writeFileSync(claudeJsonPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

/**
 * 从 `system_config` 读取 `anthropic_api_key` 并写入 `~/.claude.json`。
 * 未配置时静默跳过；写入失败仅记 warn，不中断调用方流程。
 */
export function switchClaudeAuthAccountFromDb(
  db: DatabaseSync,
  username?: string | null,
  log?: FastifyBaseLogger,
  claudeJsonPath = defaultClaudeJsonPath(),
): void {
  const authToken = resolveAnthropicAuthToken(db, username);
  if (!authToken) return;

  try {
    updateClaudeJsonAuthToken(authToken, claudeJsonPath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log?.warn({ username, err: message }, "switch claude auth: update .claude.json failed");
  }
}
