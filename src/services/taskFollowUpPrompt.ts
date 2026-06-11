/** meta_json 中追加对话队列（由 POST …/follow-up 写入） */
export const TASK_META_FOLLOW_UP_MESSAGES = "followUpMessages" as const;

function parseMetaObject(meta_json: string | null): Record<string, unknown> {
  if (!meta_json || !meta_json.trim()) return {};
  try {
    const v: unknown = JSON.parse(meta_json);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

function getFollowUpMessagesFromTaskMeta(meta_json: string | null): string[] {
  const meta = parseMetaObject(meta_json);
  const v = meta[TASK_META_FOLLOW_UP_MESSAGES];
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/** 是否存在追加对话（续跑场景） */
export function hasFollowUpMessagesInTaskMeta(meta_json: string | null): boolean {
  return getFollowUpMessagesFromTaskMeta(meta_json).length > 0;
}

/** 取 meta_json.followUpMessages 中最新一条（追加对话场景） */
export function getLatestFollowUpMessageFromTaskMeta(meta_json: string | null): string | null {
  const arr = getFollowUpMessagesFromTaskMeta(meta_json);
  return arr.length > 0 ? arr[arr.length - 1]! : null;
}

/** 追加一条对话并写回 meta_json */
export function pushFollowUpMessageToTaskMeta(meta_json: string | null, message: string): string {
  const meta = parseMetaObject(meta_json);
  const arr = getFollowUpMessagesFromTaskMeta(meta_json);
  arr.push(message.trim());
  meta[TASK_META_FOLLOW_UP_MESSAGES] = arr;
  return JSON.stringify(meta);
}

export function clearFollowUpMessagesFromTaskMeta(meta_json: string | null): string | null {
  const meta = parseMetaObject(meta_json);
  if (!(TASK_META_FOLLOW_UP_MESSAGES in meta)) return meta_json;
  delete meta[TASK_META_FOLLOW_UP_MESSAGES];
  const keys = Object.keys(meta);
  if (keys.length === 0) return null;
  return JSON.stringify(meta);
}
