/** 测试脑图同步参数（`wiki_source.wiki_url`） */
export type QaTestMindMapConfig = {
  bizId: string;
  bizType: string;
};

const DEFAULT_BIZ_TYPE = "second";

function splitBizIds(raw: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * 解析 `wiki_source` 中「测试脑图」的 `wiki_url`。
 * 支持：纯 `bizId`、逗号拼接多个 `bizId`、JSON `{ bizId, bizType }` 或 `{ bizIds, bizType }`。
 */
export function parseQaTestMindMapWikiUrls(wikiUrl: string): QaTestMindMapConfig[] {
  const raw = wikiUrl.trim();
  if (!raw) return [];

  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw) as {
        bizId?: unknown;
        bizIds?: unknown;
        bizType?: unknown;
      };
      const bizType =
        obj.bizType != null && String(obj.bizType).trim()
          ? String(obj.bizType).trim()
          : DEFAULT_BIZ_TYPE;
      if (Array.isArray(obj.bizIds)) {
        return obj.bizIds
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
          .map((bizId) => ({ bizId, bizType }));
      }
      if (obj.bizId != null) {
        return splitBizIds(String(obj.bizId)).map((bizId) => ({ bizId, bizType }));
      }
    } catch {
      return [];
    }
    return [];
  }

  return splitBizIds(raw).map((bizId) => ({ bizId, bizType: DEFAULT_BIZ_TYPE }));
}
