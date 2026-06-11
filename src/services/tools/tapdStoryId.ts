/** 云环境（api.tapd.cn）故事长 ID 前缀 */
export const TAPD_CLOUD_LONG_ID_PREFIX = "11";

/** TAPD 短 ID：≤9 位纯数字 */
export function isTapdShortStoryId(id: string): boolean {
  const s = id.trim();
  return /^\d+$/.test(s) && s.length <= 9;
}

/**
 * 将 TAPD 故事短 ID 转为长 ID（云环境规则：11 + workspace_id + 9 位短号）。
 * 已是长 ID 时原样返回。
 */
export function tapdShortStoryIdToLong(shortId: string, workspaceId: string): string {
  const short = shortId.trim();
  const ws = workspaceId.trim();
  if (!short || !ws) return short;
  if (!isTapdShortStoryId(short)) return short;
  return `${TAPD_CLOUD_LONG_ID_PREFIX}${ws}${short.padStart(9, "0")}`;
}

/**
 * 将 TAPD 故事长 ID 转为短 ID（云环境：11 + workspace_id + 9 位短号）。
 * 已是短 ID 时原样返回。
 */
export function tapdLongStoryIdToShort(longId: string, workspaceId: string): string {
  const id = longId.trim();
  const ws = workspaceId.trim();
  if (!id || !ws) return id;
  if (isTapdShortStoryId(id)) return id;

  const head = `${TAPD_CLOUD_LONG_ID_PREFIX}${ws}`;
  if (id.startsWith(head) && id.length === head.length + 9) {
    const padded = id.slice(head.length);
    if (/^\d{9}$/.test(padded)) {
      return String(parseInt(padded, 10));
    }
  }
  return id;
}

/** 确保故事 ID 为短 ID（litellm 关联等场景使用短 ID） */
export function ensureTapdShortStoryId(storyId: string, workspaceId: string): string {
  return tapdLongStoryIdToShort(storyId, workspaceId);
}
