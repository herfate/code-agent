import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { CLAUDE_ENABLED_SKILLS_CONFIG_KEY } from "../constants/systemConfigKeys.js";
import {
  deleteUserPromptTpl,
  upsertUserPromptTpl,
} from "../db/prompt/upsertUserPromptTpl.js";
import {
  deleteSystemConfig,
  getUserConfigByKey,
  upsertUserConfig,
} from "../db/systemConfig.js";
import { discoverSkills } from "../services/skill/discoverSkills.js";
import { resolveEnabledSkills } from "../services/skill/resolveSkills.js";
import { buildPromptTplMatrix } from "../services/prompt/buildPromptTplMatrix.js";
import {
  promptTplMatrixQuery,
  promptTplUserBody,
  promptTplUserQuery,
  skillConfigBody,
  skillConfigQuery,
} from "../validation/skillPromptZod.js";

export function registerSkillPromptConfigRoutes(
  app: FastifyInstance,
  deps: { db: DatabaseSync },
): void {
  const { db } = deps;

  // --- Skill ---

  app.get("/api/skills/discover", async () => {
    const skills = await discoverSkills();
    return { skills };
  });

  app.get("/api/skills/config", async (request, reply) => {
    const parsed = skillConfigQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { username } = parsed.data;
    const resolved = resolveEnabledSkills(db, username);
    const discovered = await discoverSkills();
    return {
      username,
      skills: resolved.skills,
      source: resolved.source,
      discovered,
    };
  });

  app.put("/api/skills/config", async (request, reply) => {
    const parsed = skillConfigBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { username, skills } = parsed.data;
    const cleaned = Array.from(
      new Set(skills.map((s) => s.trim()).filter((s) => s !== "")),
    );
    if (cleaned.length === 0) {
      const existing = getUserConfigByKey(db, username, CLAUDE_ENABLED_SKILLS_CONFIG_KEY);
      if (existing) deleteSystemConfig(db, existing.id);
      const resolved = resolveEnabledSkills(db, username);
      return { username, skills: resolved.skills, source: resolved.source };
    }
    upsertUserConfig(db, {
      username,
      config_key: CLAUDE_ENABLED_SKILLS_CONFIG_KEY,
      value_json: JSON.stringify(cleaned),
      description: "Claude Agent SDK 启用的 skill 名称列表（用户级）",
    });
    const resolved = resolveEnabledSkills(db, username);
    return { username, skills: resolved.skills, source: resolved.source };
  });

  app.delete("/api/skills/config", async (request, reply) => {
    const parsed = skillConfigQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { username } = parsed.data;
    const existing = getUserConfigByKey(db, username, CLAUDE_ENABLED_SKILLS_CONFIG_KEY);
    if (existing) deleteSystemConfig(db, existing.id);
    const resolved = resolveEnabledSkills(db, username);
    return { username, ok: true, skills: resolved.skills, source: resolved.source };
  });

  // --- Prompt ---

  app.get("/api/prompt-tpl/matrix", async (request, reply) => {
    const parsed = promptTplMatrixQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { username } = parsed.data;
    const cells = buildPromptTplMatrix(db, username);
    return { username, cells };
  });

  app.put("/api/prompt-tpl/user", async (request, reply) => {
    const parsed = promptTplUserBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { username, task_type, tpl_key, prompt } = parsed.data;
    const result = upsertUserPromptTpl(db, {
      username,
      task_type,
      tpl_key,
      prompt,
    });
    return {
      username,
      task_type,
      tpl_key,
      action: result.action,
      row: result.row ?? null,
    };
  });

  app.delete("/api/prompt-tpl/user", async (request, reply) => {
    const parsed = promptTplUserQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { username, task_type, tpl_key } = parsed.data;
    const ok = deleteUserPromptTpl(db, username, task_type, tpl_key);
    return { username, task_type, tpl_key, ok };
  });
}