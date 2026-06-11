function splitTestSetIds(raw: string): string[] {
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

/** 解析 `wiki_source` 中「自动化测试案例」的 `wiki_url`（支持逗号拼接多个 testSetId） */
export function parseQaTestSetWikiUrls(wikiUrl: string): string[] {
  const raw = wikiUrl.trim();
  if (!raw) return [];

  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw) as { testSetId?: unknown; testSetIds?: unknown };
      if (Array.isArray(obj.testSetIds)) {
        const ids = obj.testSetIds
          .map((item) => String(item ?? "").trim())
          .filter(Boolean);
        return [...new Set(ids)];
      }
      if (obj.testSetId != null) {
        return splitTestSetIds(String(obj.testSetId));
      }
    } catch {
      return [];
    }
    return [];
  }

  return splitTestSetIds(raw);
}

/** @deprecated 使用 {@link parseQaTestSetWikiUrls} */
export function parseQaTestSetWikiUrl(wikiUrl: string): { testSetId: string } | null {
  const ids = parseQaTestSetWikiUrls(wikiUrl);
  return ids.length > 0 ? { testSetId: ids[0]! } : null;
}
