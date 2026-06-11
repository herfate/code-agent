import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** 发现的 skill 摘要（与 `.claude/skills/<name>/SKILL.md` frontmatter 对应） */
export type DiscoveredSkill = {
  name: string;
  description: string;
};

/** 扫描 task-repo 的根目录（可调整） */
const TASK_REPO_BASE = path.join(process.cwd(), "task-repo");
/** skill 目录下描述文件的相对路径 */
const SKILL_MD_REL = path.join(".claude", "skills");

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
  let baseEntries: import("node:fs").Dirent[];
  try {
    baseEntries = await readdir(TASK_REPO_BASE, { withFileTypes: true });
  } catch {
    return [];
  }
  const map = new Map<string, DiscoveredSkill>();
  for (const entry of baseEntries) {
    if (!entry.isDirectory()) continue;
    const skillsDir = path.join(TASK_REPO_BASE, entry.name, SKILL_MD_REL);
    let skillDirs: import("node:fs").Dirent[];
    try {
      skillDirs = await readdir(skillsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const skillDir of skillDirs) {
      if (!skillDir.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, skillDir.name, "SKILL.md");
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
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** 发现全部可用 skill（带 60s 内存缓存）；task-repo 不存在时返回空数组 */
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

/** 仅供测试：确认 task-repo 根目录是否存在 */
export async function taskRepoExists(): Promise<boolean> {
  try {
    const s = await stat(TASK_REPO_BASE);
    return s.isDirectory();
  } catch {
    return false;
  }
}
