import type { PromptTplRow } from "../../db/promptTpl.js";

/** 取模板 `prompt` 原文：优先 `username` 非 `*`，否则回退 `*`（不拼接） */
export function firstPromptTplContent(templates: PromptTplRow[]): string | null {
  const isWildcard = (u: string | null | undefined) => (u?.trim() ?? "") === "*";
  const row =
    templates.find((t) => !isWildcard(t.username)) ??
    templates.find((t) => isWildcard(t.username));
  const content = row?.prompt?.trim();
  return content || null;
}
