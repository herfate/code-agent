import { marked } from "marked";

/** TAPD 富文本字段长度上限（与路由 Zod 校验一致） */
export const TAPD_HTML_MAX_LEN = 100_000;

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** 将 Markdown 转为 HTML（供 TAPD 评论、需求描述等不支持 Markdown 的场景） */
export function markdownToHtml(markdown: string): string {
  const html = marked.parse(String(markdown ?? ""), { async: false });
  return typeof html === "string" ? html.trim() : "";
}

export function truncateHtmlForTapd(body: string): { text: string; truncated: boolean } {
  if (body.length <= TAPD_HTML_MAX_LEN) {
    return { text: body, truncated: false };
  }
  const suffix = '<p>…（内容已截断）</p>';
  const max = TAPD_HTML_MAX_LEN - suffix.length;
  return { text: body.slice(0, Math.max(0, max)) + suffix, truncated: true };
}

/** Markdown → HTML，并按 TAPD 字段长度上限截断 */
export function markdownToTapdHtml(markdown: string): { html: string; truncated: boolean } {
  const { text, truncated } = truncateHtmlForTapd(markdownToHtml(markdown));
  return { html: text, truncated };
}
