import { formatTapdTaskIdInput, TAPD_TASK_ID_CANONICAL_RE } from "./tapdTaskIdFormat.js";

/** `env.ANTHROPIC_CUSTOM_HEADERS` 中 x-litellm-tags 行的 story 前缀 */
export const LITELLM_TAGS_CUSTOM_HEADER_PREFIX = "x-litellm-tags: story=";

/**
 * TAPD 关联输入 → `env.ANTHROPIC_CUSTOM_HEADERS` 值。
 * 空输入为 `''`；已含完整 `x-litellm-tags:` 行则原样保留。
 */
export function formatAnthropicCustomHeadersFromTapdTaskId(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (/^x-litellm-tags\s*:/i.test(trimmed)) return trimmed;
  const canonical = formatTapdTaskIdInput(trimmed);
  if (TAPD_TASK_ID_CANONICAL_RE.test(canonical)) {
    return `x-litellm-tags: ${canonical}`;
  }
  if (/^story=/i.test(trimmed)) return `x-litellm-tags: ${trimmed}`;
  return `${LITELLM_TAGS_CUSTOM_HEADER_PREFIX}${trimmed}`;
}

export { normalizeTapdTaskIdForStorage } from "./tapdTaskIdFormat.js";
