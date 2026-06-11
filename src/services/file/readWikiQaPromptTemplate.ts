import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tplDir = join(__dirname, "..", "..", "..", "docs", "tpl");

/** 允许加载的模板 id（防路径穿越） */
const TEMPLATE_ID_RE = /^[a-z0-9-]+$/;

export function isWikiQaPromptTemplateId(id: string): boolean {
  return TEMPLATE_ID_RE.test(id);
}

/** 读取 Wiki 智能问答快捷模板 Markdown（`docs/tpl/<id>.md`） */
export function readWikiQaPromptTemplate(templateId: string): string | null {
  if (!isWikiQaPromptTemplateId(templateId)) return null;
  const filePath = join(tplDir, `${templateId}.md`);
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
