/**
 * TAPD 故事 ID 格式化（浏览器端，与 src/services/tools/tapdStoryId.ts 规则一致）
 */
(function (global) {
  var TAPD_CLOUD_LONG_ID_PREFIX = "11";

  function isTapdShortStoryId(id) {
    var s = String(id || "").trim();
    return /^\d+$/.test(s) && s.length <= 9;
  }

  function ensureTapdShortStoryId(storyId, workspaceId) {
    var id = String(storyId || "").trim();
    var ws = String(workspaceId || "").trim();
    if (!id || !ws) return id;
    if (isTapdShortStoryId(id)) return id;
    var head = TAPD_CLOUD_LONG_ID_PREFIX + ws;
    if (id.indexOf(head) === 0 && id.length === head.length + 9) {
      var padded = id.slice(head.length);
      if (/^\d{9}$/.test(padded)) return String(parseInt(padded, 10));
    }
    return id;
  }

  /** 短 ID → 云环境长 ID：11 + workspaceId + 9 位短号 */
  function tapdShortStoryIdToLong(shortId, workspaceId) {
    var short = String(shortId || "").trim();
    var ws = String(workspaceId || "").trim();
    if (!short || !ws) return short;
    if (!isTapdShortStoryId(short)) return short;
    return TAPD_CLOUD_LONG_ID_PREFIX + ws + short.padStart(9, "0");
  }

  function formatTapdStoryIdWithWorkspace(storyId, workspaceId) {
    var ws = String(workspaceId || "").trim();
    return "story=" + ensureTapdShortStoryId(storyId, ws) + "@tapd-" + ws;
  }

  var TAPD_TASK_ID_EXTRACT_RE =
    /(?:x-litellm-tags\s*:\s*)?(?:--)?(?:story\s*=?\s*)?(\d+)\s*@\s*tapd\s*-\s*(\d+)/i;
  var TAPD_FE_STORY_URL_RE =
    /(?:https?:\/\/)?(?:www\.)?tapd\.cn\/tapd_fe\/(\d+)\/story\/detail\/(\d+)/i;
  var TAPD_PRONG_STORY_URL_RE =
    /(?:https?:\/\/)?(?:www\.)?tapd\.cn\/(\d+)\/prong\/stories\/view\/(\d+)/i;
  var TAPD_SHORT_STORY_URL_RE =
    /(?:https?:\/\/)?(?:www\.)?tapd\.cn\/(\d+)\/s\/(\d+)/i;

  /** 解析 story=@tapd / 链接，返回 { storyId, workspaceId }；无法解析返回 null */
  function parseTapdStoryRef(raw) {
    var value = String(raw || "").trim();
    if (!value) return null;
    var m = TAPD_TASK_ID_EXTRACT_RE.exec(value);
    if (m) return { storyId: m[1], workspaceId: m[2] };
    var feMatch = TAPD_FE_STORY_URL_RE.exec(value);
    if (feMatch) return { storyId: feMatch[2], workspaceId: feMatch[1] };
    var prongMatch = TAPD_PRONG_STORY_URL_RE.exec(value);
    if (prongMatch) return { storyId: prongMatch[2], workspaceId: prongMatch[1] };
    var shortMatch = TAPD_SHORT_STORY_URL_RE.exec(value);
    if (shortMatch) return { storyId: shortMatch[2], workspaceId: shortMatch[1] };
    return null;
  }

  /**
   * 浏览器打开 TAPD 故事详情页（官方 tapd_fe 格式，须用长 ID）。
   * https://www.tapd.cn/tapd_fe/{workspaceId}/story/detail/{longStoryId}
   */
  function buildTapdStoryPageUrl(workspaceId, storyId) {
    var ws = String(workspaceId || "").trim();
    var id = String(storyId || "").trim();
    if (!ws || !id) return "";
    var longId = tapdShortStoryIdToLong(id, ws);
    return (
      "https://www.tapd.cn/tapd_fe/" +
      encodeURIComponent(ws) +
      "/story/detail/" +
      encodeURIComponent(longId)
    );
  }

  /** 从 story=@tapd、TAPD 链接等提取并格式化为短 ID 关联串 */
  function formatTapdTaskIdInput(raw) {
    var value = String(raw || "").trim();
    if (!value) return "";
    var m = TAPD_TASK_ID_EXTRACT_RE.exec(value);
    if (m) return formatTapdStoryIdWithWorkspace(m[1], m[2]);
    var feMatch = TAPD_FE_STORY_URL_RE.exec(value);
    if (feMatch) return formatTapdStoryIdWithWorkspace(feMatch[2], feMatch[1]);
    var prongMatch = TAPD_PRONG_STORY_URL_RE.exec(value);
    if (prongMatch) return formatTapdStoryIdWithWorkspace(prongMatch[2], prongMatch[1]);
    var shortMatch = TAPD_SHORT_STORY_URL_RE.exec(value);
    if (shortMatch) return formatTapdStoryIdWithWorkspace(shortMatch[2], shortMatch[1]);
    return value;
  }

  global.TapdStoryId = {
    isTapdShortStoryId: isTapdShortStoryId,
    ensureTapdShortStoryId: ensureTapdShortStoryId,
    tapdShortStoryIdToLong: tapdShortStoryIdToLong,
    formatTapdStoryIdWithWorkspace: formatTapdStoryIdWithWorkspace,
    formatTapdTaskIdInput: formatTapdTaskIdInput,
    parseTapdStoryRef: parseTapdStoryRef,
    buildTapdStoryPageUrl: buildTapdStoryPageUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
