/** Wiki 知识库分类（对应 `wiki_base/<id>/` 子目录） */
export const WIKI_CATEGORIES = [
  { id: "1", label: "大陆清算" },
  { id: "2", label: "大陆资金" },
  { id: "3", label: "大陆账户" },
  { id: "4", label: "大陆支付" },
] as const;

export type WikiCategoryId = (typeof WIKI_CATEGORIES)[number]["id"];

const WIKI_CATEGORY_ID_SET = new Set<string>(WIKI_CATEGORIES.map((c) => c.id));

export function isWikiCategoryId(value: string): value is WikiCategoryId {
  return WIKI_CATEGORY_ID_SET.has(value);
}

export function getWikiCategoryLabel(id: string): string | undefined {
  return WIKI_CATEGORIES.find((c) => c.id === id)?.label;
}
