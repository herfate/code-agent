import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveProjectSkillsDir } from "./copyProjectSkillsToClaudeDir.js";

/** 发现的 skill 摘要（与 `skills/<name>/SKILL.md` frontmatter 对应） */
export type DiscoveredSkill = {
  name: string;
  description: string;
};

/** 内存缓存（避免每次请求都遍历文件系统） */
let cache: { at: number; skills: DiscoveredSkill[] } | null = null;
const CACHE_TTL_MS = 60_000;

/** 解析 SKILL.md 首部 `---` frontmatter 的 `name` / `description`；无则回退目录名 */
function parseFrontmatter(content: string, fallbackName: string): DiscoveredSkill {
  const text = content.replace(/^﻿/, "");
  if (!text.startsWith("---")) {
    return { name: fallbackName, description: "" };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { name: fallbackName, description: "" };
  const block = text.slice(3, end);
  let name = "";
  let description = "";
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name" && val) name = val;
    else if (key === "description") description = val;
  }
  return { name: name || fallbackName, description };
}

async function scanOnce(): Promise<DiscoveredSkill[]> {
  const skillsRoot = resolveProjectSkillsDir();
  let skillDirs: import("node:fs").Dirent[];
  try {
    skillDirs = await readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const map = new Map<string, DiscoveredSkill>();
  for (const skillDir of skillDirs) {
    if (!skillDir.isDirectory()) continue;
    const skillMdPath = path.join(skillsRoot, skillDir.name, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillMdPath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(content, skillDir.name);
    if (!map.has(parsed.name)) {
      map.set(parsed.name, parsed);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** 发现全部可用 skill（带 60s 内存缓存）；仓库根 `skills/` 不存在时返回空数组 */
export async function discoverSkills(): Promise<DiscoveredSkill[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.skills;
  }
  const skills = await scanOnce();
  cache = { at: now, skills };
  return skills;
}

/** 强制清空缓存（测试或手动刷新场景） */
export function invalidateSkillCache(): void {
  cache = null;
}

/** 确认仓库根 `skills/` 是否存在 */
export async function projectSkillsDirExists(): Promise<boolean> {
  try {
    const s = await stat(resolveProjectSkillsDir());
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** @deprecated 使用 {@link projectSkillsDirExists}；保留别名以免外部测试引用断裂 */
export async function taskRepoExists(): Promise<boolean> {
  return projectSkillsDirExists();
}
