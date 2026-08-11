import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AppLog } from "../appLogger.js";

/** 仓库根 `skills/`：知识沉淀等任务的规范源 */
export function resolveProjectSkillsDir(cwd = process.cwd()): string {
  return path.join(cwd, "skills");
}

/** 会话工作区 Claude skills 目录：`{taskRepoCwd}/.claude/skills` */
export function resolveTaskClaudeSkillsDir(taskRepoCwd: string): string {
  return path.join(taskRepoCwd, ".claude", "skills");
}

export type CopyProjectSkillsResult = {
  /** 已复制的 skill 目录名 */
  copied: string[];
  /** 源目录是否存在 */
  sourceExists: boolean;
};

/**
 * 将仓库根 `skills/<name>/`（须含 SKILL.md）复制到会话 `{taskRepoCwd}/.claude/skills/<name>/`。
 * 源不存在或为空时记 warn、不抛错。
 */
export function copyProjectSkillsToClaudeDir(taskRepoCwd: string): CopyProjectSkillsResult {
  const srcRoot = resolveProjectSkillsDir();
  const destRoot = resolveTaskClaudeSkillsDir(taskRepoCwd);
  const copied: string[] = [];

  if (!existsSync(srcRoot)) {
    AppLog.logger.warn({ srcRoot, taskRepoCwd }, "copy project skills: source dir missing, skip");
    return { copied, sourceExists: false };
  }

  let entries: string[];
  try {
    entries = readdirSync(srcRoot);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    AppLog.logger.warn({ srcRoot, err: message }, "copy project skills: readdir failed, skip");
    return { copied, sourceExists: true };
  }

  mkdirSync(destRoot, { recursive: true });

  for (const name of entries) {
    const srcDir = path.join(srcRoot, name);
    let isDir = false;
    try {
      isDir = statSync(srcDir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const skillMd = path.join(srcDir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const destDir = path.join(destRoot, name);
    try {
      cpSync(srcDir, destDir, { recursive: true, force: true });
      copied.push(name);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      AppLog.logger.warn({ name, destDir, err: message }, "copy project skills: cp failed for one skill");
    }
  }

  if (copied.length === 0) {
    AppLog.logger.warn({ srcRoot, taskRepoCwd }, "copy project skills: no SKILL.md dirs found");
  }

  return { copied, sourceExists: true };
}
