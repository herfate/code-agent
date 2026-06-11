import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyBaseLogger } from "fastify";
import { resolveAnthropicAuthToken } from "../dbConfig.js";
import { formatAnthropicCustomHeadersFromTapdTaskId } from "./formatAnthropicCustomHeaders.js";

/** 按 settings 文件路径串行化写入，同路径并发排队，不同工作区可并行 */
const settingsWriteTails = new Map<string, Promise<void>>();

/** 在指定 settings 路径的互斥锁内执行写入；并发调用同路径会排队 */
export function runWithClaudeSettingsWriteLock<T>(
  settingsPath: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const prev = settingsWriteTails.get(settingsPath) ?? Promise.resolve();
  const next = prev.then(fn);
  settingsWriteTails.set(
    settingsPath,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** 全局 Claude Code 用户配置路径（只读参考，不再作为默认写入目标） */
export function defaultClaudeJsonPath(): string {
  return path.join(homedir(), ".claude", "settings.json");
}

/** 工作区项目级 settings 路径：`{taskRepoCwd}/.claude/settings.json` */
export function resolveProjectClaudeSettingsPath(taskRepoCwd: string): string {
  const cwd = taskRepoCwd.trim();
  if (!cwd) throw new Error("taskRepoCwd 不能为空");
  return path.join(cwd, ".claude", "settings.json");
}

/** 确保工作区 `.claude` 目录存在 */
export function ensureProjectClaudeSettingsDir(taskRepoCwd: string): void {
  mkdirSync(path.join(taskRepoCwd, ".claude"), { recursive: true });
}

function loadClaudeSettingsDoc(claudeJsonPath: string): Record<string, unknown> {
  if (!existsSync(claudeJsonPath)) return {};
  const raw = readFileSync(claudeJsonPath, "utf8");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("根节点须为 JSON 对象");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`解析 ${claudeJsonPath} 失败: ${message}`);
  }
}

function saveClaudeSettingsDoc(claudeJsonPath: string, doc: Record<string, unknown>): void {
  writeFileSync(claudeJsonPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

function mergeClaudeSettingsEnv(
  doc: Record<string, unknown>,
  envPatch: Record<string, string>,
): Record<string, unknown> {
  const prevEnv = doc.env;
  const env =
    prevEnv && typeof prevEnv === "object" && !Array.isArray(prevEnv)
      ? { ...(prevEnv as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(envPatch)) {
    env[key] = value;
  }
  return { ...doc, env };
}

/**
 * 将 Bearer Token 写入项目 settings 的 `env.ANTHROPIC_AUTH_TOKEN`。
 * 文件不存在时会创建最小结构；已有 `env` 时仅覆盖该字段。
 */
export function updateClaudeJsonAuthToken(authToken: string, claudeJsonPath: string): void {
  const token = authToken.trim();
  if (!token) throw new Error("authToken 不能为空");
  const doc = loadClaudeSettingsDoc(claudeJsonPath);
  saveClaudeSettingsDoc(
    claudeJsonPath,
    mergeClaudeSettingsEnv(doc, { ANTHROPIC_AUTH_TOKEN: token }),
  );
}

/** 覆盖 `env.ANTHROPIC_CUSTOM_HEADERS`（Claude SDK 请求自定义头，`Name: Value` 格式） */
export function updateClaudeJsonAnthropicCustomHeaders(
  customHeaders: string,
  claudeJsonPath: string,
): void {
  const doc = loadClaudeSettingsDoc(claudeJsonPath);
  saveClaudeSettingsDoc(
    claudeJsonPath,
    mergeClaudeSettingsEnv(doc, { ANTHROPIC_CUSTOM_HEADERS: customHeaders ?? "" }),
  );
}

/**
 * 认领任务执行 Claude SDK 前：从 DB 读取配置，写入工作区 `.claude/settings.json`。
 * 含 Auth Token 与 TAPD custom headers；未配置 token 时仍写入 custom headers。
 */
export function switchClaudeSettingsForTaskFromDb(
  db: DatabaseSync,
  taskRepoCwd: string,
  username?: string | null,
  tapdTaskId?: string | null,
  log?: FastifyBaseLogger,
): void {
  try {
    ensureProjectClaudeSettingsDir(taskRepoCwd);
    const claudeJsonPath = resolveProjectClaudeSettingsPath(taskRepoCwd);
    const doc = loadClaudeSettingsDoc(claudeJsonPath);
    const envPatch: Record<string, string> = {
      ANTHROPIC_CUSTOM_HEADERS: formatAnthropicCustomHeadersFromTapdTaskId(tapdTaskId),
    };
    const authToken = resolveAnthropicAuthToken(db, username);
    if (authToken?.trim()) {
      envPatch.ANTHROPIC_AUTH_TOKEN = authToken.trim();
    }
    saveClaudeSettingsDoc(claudeJsonPath, mergeClaudeSettingsEnv(doc, envPatch));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log?.warn({ username, taskRepoCwd, err: message }, "switch claude settings for task failed");
  }
}

/** 带 settings 写入锁的异步版本，供 tick 内并行任务扫描使用 */
export async function switchClaudeSettingsForTaskFromDbAsync(
  db: DatabaseSync,
  taskRepoCwd: string,
  username?: string | null,
  tapdTaskId?: string | null,
  log?: FastifyBaseLogger,
): Promise<void> {
  const settingsPath = resolveProjectClaudeSettingsPath(taskRepoCwd);
  await runWithClaudeSettingsWriteLock(settingsPath, () =>
    switchClaudeSettingsForTaskFromDb(db, taskRepoCwd, username, tapdTaskId, log),
  );
}

/**
 * 从 `system_config` 读取 `anthropic_api_key` 并写入工作区 `.claude/settings.json`。
 * 未配置时静默跳过；写入失败仅记 warn，不中断调用方流程。
 */
export function switchClaudeAuthAccountFromDb(
  db: DatabaseSync,
  taskRepoCwd: string,
  username?: string | null,
  log?: FastifyBaseLogger,
): void {
  const authToken = resolveAnthropicAuthToken(db, username);
  if (!authToken) return;

  try {
    ensureProjectClaudeSettingsDir(taskRepoCwd);
    updateClaudeJsonAuthToken(authToken, resolveProjectClaudeSettingsPath(taskRepoCwd));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log?.warn({ username, taskRepoCwd, err: message }, "switch claude auth: update project settings failed");
  }
}

/** 带 settings 写入锁的异步版本，供 tick 内并行任务扫描使用 */
export async function switchClaudeAuthAccountFromDbAsync(
  db: DatabaseSync,
  taskRepoCwd: string,
  username?: string | null,
  log?: FastifyBaseLogger,
): Promise<void> {
  const settingsPath = resolveProjectClaudeSettingsPath(taskRepoCwd);
  await runWithClaudeSettingsWriteLock(settingsPath, () =>
    switchClaudeAuthAccountFromDb(db, taskRepoCwd, username, log),
  );
}
