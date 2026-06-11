import type { DatabaseSync } from "node:sqlite";
import { CLAUDE_ENABLED_SKILLS_CONFIG_KEY } from "../../constants/systemConfigKeys.js";
import { resolveConfigByKey, type ConfigScope } from "../../db/systemConfig.js";
import { parseConfigStringValue } from "../dbConfig.js";

export type SkillSource = "user" | "global" | "default";

export type ResolvedSkills = {
  skills: string[];
  source: SkillSource;
};

/** 从 `system_config` 解析已启用的 skill 列表：用户级优先，全局回退，无配置时返回空数组 */
export function resolveEnabledSkills(
  db: DatabaseSync,
  username: string | null | undefined,
): ResolvedSkills {
  const hit = resolveConfigByKey(db, username, CLAUDE_ENABLED_SKILLS_CONFIG_KEY);
  if (!hit) return { skills: [], source: "default" };
  const raw = parseConfigStringValue(hit.row.value_json);
  if (!raw.trim()) return { skills: [], source: hit.source };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const skills = parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "");
      return { skills, source: hit.source };
    }
  } catch {
    /* value_json 非 JSON，忽略 */
  }
  return { skills: [], source: hit.source };
}
