/** Wiki 知识库分类（对应 `wiki_base/<id>/` 子目录） */
export const WIKI_CATEGORIES = [
  { id: "1", label: "大陆清算" },
  { id: "2", label: "大陆资金" },
  { id: "3", label: "大陆账户" },
  { id: "4", label: "大陆支付" },
  { id: "5", label: "海外清算" },
  { id: "6", label: "海外资金" },
  { id: "7", label: "海外账户" },
  { id: "8", label: "海外支付" },
  { id: "9", label: "海外中台" },
  { id: "10", label: "电子签名" },
  { id: "11", label: "零售中台" },
] as const;

export type WikiCategoryId = (typeof WIKI_CATEGORIES)[number]["id"];

const WIKI_CATEGORY_ID_SET = new Set<string>(WIKI_CATEGORIES.map((c) => c.id));

export function isWikiCategoryId(value: string): value is WikiCategoryId {
  return WIKI_CATEGORY_ID_SET.has(value);
}

export function getWikiCategoryLabel(id: string): string | undefined {
  return WIKI_CATEGORIES.find((c) => c.id === id)?.label;
}
