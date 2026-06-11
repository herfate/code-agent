import { ensureTapdShortStoryId } from "../tools/tapdStoryId.js";

/** 落库 / 校验用的标准格式：`story={短ID}@tapd-{workspaceId}` */
export const TAPD_TASK_ID_CANONICAL_RE = /^story=\d+@tapd-\d+$/i;

/** 从多种输入中提取 story 与 tapd workspace 数字段（含 `--story=`、x-litellm-tags 等） */
export const TAPD_TASK_ID_EXTRACT_RE =
  /(?:x-litellm-tags\s*:\s*)?(?:--)?(?:story\s*=?\s*)?(\d+)\s*@\s*tapd\s*-\s*(\d+)/i;

/** tapd_fe 新链接：/tapd_fe/{workspaceId}/story/detail/{storyId} */
export const TAPD_FE_STORY_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?tapd\.cn\/tapd_fe\/(\d+)\/story\/detail\/(\d+)/i;

/** 经典链接：/{workspaceId}/prong/stories/view/{storyId} */
export const TAPD_PRONG_STORY_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?tapd\.cn\/(\d+)\/prong\/stories\/view\/(\d+)/i;

/** 短链接：/{workspaceId}/s/{storyId}（storyId 为短 ID，调用 API 前需转长 ID） */
export const TAPD_SHORT_STORY_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?tapd\.cn\/(\d+)\/s\/(\d+)/i;

export const TAPD_TASK_ID_VALIDATION_MESSAGE =
  "TAPD 关联格式须为 story={故事短ID}@tapd-{空间ID}，例如 story=1364737@tapd-59626479";

/** 格式化为 `story={短ID}@tapd-{workspaceId}` */
export function formatTapdStoryIdWithWorkspace(storyId: string, workspaceId: string): string {
  const ws = workspaceId.trim();
  const shortId = ensureTapdShortStoryId(storyId.trim(), ws);
  return `story=${shortId}@tapd-${ws}`;
}

/**
 * 从 story=@tapd、TAPD 链接等输入提取并格式化为标准关联串（故事 ID 统一为短 ID）。
 * 无法匹配时返回 trim 后原文。
 */
export function formatTapdTaskIdInput(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";

  const m = TAPD_TASK_ID_EXTRACT_RE.exec(value);
  if (m) return formatTapdStoryIdWithWorkspace(m[1], m[2]);

  const feMatch = TAPD_FE_STORY_URL_RE.exec(value);
  if (feMatch) return formatTapdStoryIdWithWorkspace(feMatch[2], feMatch[1]);

  const prongMatch = TAPD_PRONG_STORY_URL_RE.exec(value);
  if (prongMatch) return formatTapdStoryIdWithWorkspace(prongMatch[2], prongMatch[1]);

  const shortMatch = TAPD_SHORT_STORY_URL_RE.exec(value);
  if (shortMatch) return formatTapdStoryIdWithWorkspace(shortMatch[2], shortMatch[1]);

  return value;
}

export function isValidTapdTaskId(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim();
  if (!value) return true;
  return TAPD_TASK_ID_CANONICAL_RE.test(formatTapdTaskIdInput(value));
}

/** 落库：先格式化再校验，合法则返回标准串，否则 undefined */
export function normalizeTapdTaskIdForStorage(raw: string | null | undefined): string | undefined {
  const formatted = formatTapdTaskIdInput(raw);
  if (!formatted) return undefined;
  if (!TAPD_TASK_ID_CANONICAL_RE.test(formatted)) return undefined;
  return formatted;
}

export { ensureTapdShortStoryId, isTapdShortStoryId } from "../tools/tapdStoryId.js";
