import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { WikiCategoryId } from "../../constants/wikiCategory.js";
import { readWikiBaseFile, type WikiBaseFileContent } from "../file/wikiBaseFiles.js";
import { getWikiBaseRoot } from "../file/writeWikiBaseMarkdown.js";
import {
  downloadConfluenceAttachment,
  fetchConfluencePageMarkdown,
  listConfluencePageImageAttachments,
  resolveConfluenceCredentials,
  type ConfluenceAttachmentItem,
} from "../tools/confluenceClient.js";
import { ocrImageBuffers, shouldSkipImageOcr } from "../tools/ocrSpaceOcr.js";
import { bufferToDataUrl, chat as multimodalChat } from "../tools/multimodalUtil.js";

export type WikiConfluenceReloadConverter = "ocrspace" | "multimodal";

export type WikiConfluencePageReloadResult = {
  /** 原始未修改的文档（磁盘上的内容不变） */
  doc: WikiBaseFileContent;
  /** 用于页面展示的 Markdown（原始内容 + 每张图片后紧跟识别结果，遵循原始位置） */
  display_markdown: string;
  images_downloaded: number;
  images_failed: number;
  /** OCR 识别成功张数（converter=ocrspace 时有意义） */
  images_ocr_recognized: number;
  /** 多模态识别成功张数（converter=multimodal 时有意义） */
  images_multimodal_recognized: number;
  warnings: string[];
  converter: WikiConfluenceReloadConverter;
};

/** 从已同步 Markdown 头部或文件名解析 Confluence pageId */
export function parseConfluencePageIdFromWikiMarkdown(
  content: string,
  relativePath: string,
): string | null {
  const fromHeader = content.match(/^Confluence pageId:\s*(\d+)/m)?.[1];
  if (fromHeader) return fromHeader;
  const baseName = relativePath.split("/").pop() ?? "";
  const fromName = baseName.match(/^(\d+)_/)?.[1];
  return fromName ?? null;
}

function parseConfluencePageUrlFromWikiMarkdown(content: string): string | undefined {
  return content.match(/^source:\s*(\S+)/m)?.[1]?.trim();
}

function assertUnderWikiBaseRoot(absPath: string): void {
  const root = getWikiBaseRoot();
  const normalized = resolve(absPath);
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error("path outside wiki_base");
  }
}

function wikiAssetsDir(categoryId: WikiCategoryId, mdRelativePath: string, pageId: string): string {
  const mdDir = dirname(mdRelativePath.replace(/\\/g, "/"));
  const assetsRel = mdDir && mdDir !== "." ? `${mdDir}/_assets/${pageId}` : `_assets/${pageId}`;
  return assetsRel.replace(/\\/g, "/");
}

/** 将 Markdown 中图片引用改写为相对 `_assets/{pageId}/` 路径 */
export function rewriteMarkdownImageRefsToLocalAssets(
  markdown: string,
  pageId: string,
  assetsRelPrefix: string,
  filenames: Set<string>,
): string {
  const filenamePattern = [...filenames]
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!filenamePattern) return markdown;

  const attachmentUrlRe = new RegExp(
    `(^|[\\s("'])https?:\\/\\/[^\\s"')]+\\/download\\/attachments\\/${pageId}\\/(${filenamePattern})(?:\\?[^\\s"')]*)?`,
    "gi",
  );

  let out = markdown.replace(attachmentUrlRe, (_m, prefix, filename) => {
    return `${prefix}${assetsRelPrefix}/${decodeURIComponent(filename)}`;
  });

  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, rawSrc) => {
    const src = String(rawSrc).trim();
    if (/^https?:\/\//i.test(src) || /^data:/i.test(src) || src.startsWith(`${assetsRelPrefix}/`)) {
      return full;
    }
    const decoded = decodeURIComponent(src.split("?")[0].split("#")[0]);
    const base = decoded.split(/[/\\]/).pop() ?? decoded;
    if (!filenames.has(base)) return full;
    return `![${alt}](${assetsRelPrefix}/${base})`;
  });

  return out;
}

/** 去掉历史 OCR 块，便于重复「图片ocr」 */
function stripOcrBlocks(markdown: string): string {
  return markdown.replace(/\n?<!--\s*ocr:[^>]+-->\s*[\s\S]*?<!--\s*\/ocr\s*-->/g, "");
}

/** 去掉历史多模态块，便于重复「多模态识别」 */
function stripMultimodalBlocks(markdown: string): string {
  return markdown.replace(
    /\n?<!--\s*multimodal:[^>]+-->\s*[\s\S]*?<!--\s*\/multimodal\s*-->/g,
    "",
  );
}

/** 构建单张图片的 OCR 块（HTML 注释包裹，便于重复「图片ocr」时移除） */
function buildOcrBlock(filename: string, text: string): string {
  return `\n\n<!-- ocr:${filename} -->\n\n**图片文字识别（${filename}）：**\n\n${text}\n\n<!-- /ocr -->`;
}

/** 构建单张图片的多模态 Markdown 块（预览侧用边框包裹展示） */
function buildMultimodalBlock(filename: string, markdown: string): string {
  return `\n\n<!-- multimodal:${filename} -->\n\n**多模态识别（${filename}）：**\n\n${markdown}\n\n<!-- /multimodal -->`;
}


/**
 * 在每张图片行后插入识别结果块，遵循图片在文档中的原始位置。
 * @param buildBlock 按文件名生成插入块
 */
function injectBlocksAfterImages(
  markdown: string,
  assetsRelPrefix: string,
  textByFilename: Map<string, string>,
  buildBlock: (filename: string, text: string) => string,
): string {
  if (textByFilename.size === 0) return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    out.push(line);
    const m = line.match(/!\[[^\]]*\]\(([^)]+)\)/);
    if (!m) continue;
    const src = m[1].trim();
    const base = decodeURIComponent(src.split("?")[0].split("#")[0]).split(/[/\\]/).pop() ?? "";
    if (!base || !src.includes(assetsRelPrefix)) continue;
    const text = textByFilename.get(base);
    if (!text) continue;
    out.push(buildBlock(base, text).trimStart());
  }

  return out.join("\n");
}

function mimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

/** 矢量图等不适合多模态视觉理解的格式 */
const MULTIMODAL_SKIP_EXT = /\.(svg|ico)$/i;

function shouldSkipMultimodal(filename: string): boolean {
  return MULTIMODAL_SKIP_EXT.test(filename);
}

const MULTIMODAL_IMAGE_PROMPT = `请将这张图片的可见内容转为结构化 Markdown，要求：
1. 忠实还原文字、表格、列表与标题层级；UI 截图按界面结构整理
2. 表格用 Markdown 表格；代码或配置用 fenced code block
3. 不要描述「这是一张图」之类的元叙述，直接输出可用的 Markdown 正文
4. 不要用 \`\`\`markdown 包裹整个回答`;

/** 去掉模型偶发包裹的整段 ```markdown / ``` 围栏 */
function stripOuterMarkdownFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return m ? m[1].trim() : t;
}

/** 逐张调用多模态接口，将图片转为 Markdown */
async function recognizeImagesAsMarkdown(
  db: DatabaseSync,
  buffers: Map<string, Buffer>,
): Promise<{ byFilename: Map<string, string>; warnings: string[]; recognized: number }> {
  const byFilename = new Map<string, string>();
  const warnings: string[] = [];
  let recognized = 0;

  for (const [name, buf] of buffers) {
    if (shouldSkipMultimodal(name)) {
      warnings.push(`${name}: 跳过多模态（不支持的格式）`);
      continue;
    }
    try {
      const dataUrl = bufferToDataUrl(buf, mimeFromFilename(name));
      const raw = await multimodalChat(MULTIMODAL_IMAGE_PROMPT, [{ url: dataUrl, detail: "high" }], db);
      const md = stripOuterMarkdownFence(raw);
      if (md) {
        byFilename.set(name, md);
        recognized += 1;
      } else {
        warnings.push(`${name}: 多模态返回空内容`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "MULTIMODAL_API_KEY_MISSING") throw e;
      warnings.push(`${name}: ${msg}`);
    }
  }

  return { byFilename, warnings, recognized };
}

/** 下载图片附件到磁盘（供 asset 端点展示）并保留内存 buffer（供 OCR） */
async function savePageImageAttachments(
  siteBase: string,
  creds: { username: string; password: string },
  attachments: ConfluenceAttachmentItem[],
  assetsAbsDir: string,
): Promise<{
  saved: number;
  failed: number;
  filenames: Set<string>;
  buffers: Map<string, Buffer>;
  warnings: string[];
}> {
  mkdirSync(assetsAbsDir, { recursive: true });
  const filenames = new Set<string>();
  const buffers = new Map<string, Buffer>();
  const warnings: string[] = [];
  let saved = 0;
  let failed = 0;

  for (const att of attachments) {
    try {
      const buf = await downloadConfluenceAttachment(siteBase, att.downloadPath, creds);
      const safeName = att.filename.replace(/[\\/:*?"<>|]/g, "_");
      const absPath = join(assetsAbsDir, safeName);
      assertUnderWikiBaseRoot(absPath);
      // 写入图片文件到磁盘（供 /api/wiki-base/:categoryId/asset 端点展示）
      writeFileSync(absPath, buf);
      filenames.add(att.filename);
      if (safeName !== att.filename) filenames.add(safeName);
      buffers.set(safeName, buf);
      saved += 1;
    } catch (e) {
      failed += 1;
      warnings.push(`${att.filename}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { saved, failed, filenames, buffers, warnings };
}

/**
 * 从 Confluence 重新拉取单页图片附件，并按 converter 识别为文字/Markdown 注入展示内容。
 * 识别结果按图片原始位置插入展示内容，并将识别后的 Markdown 写回磁盘上的 .md 文件（同步修改本地文件）。
 */
export async function reloadWikiConfluencePage(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
  relativePath: string,
  converter: WikiConfluenceReloadConverter = "ocrspace",
): Promise<WikiConfluencePageReloadResult> {
  const existing = readWikiBaseFile(categoryId, relativePath);
  if (!existing) {
    throw new Error("file not found");
  }

  const pageId = parseConfluencePageIdFromWikiMarkdown(existing.content, relativePath);
  if (!pageId) {
    throw new Error("无法识别 Confluence pageId（需文件头 Confluence pageId: 或 {pageId}_ 文件名）");
  }

  const creds = resolveConfluenceCredentials(db);
  if (!creds) {
    throw new Error("CONFLUENCE_CREDENTIALS_MISSING");
  }

  const pageUrl = parseConfluencePageUrlFromWikiMarkdown(existing.content);
  const fetched = await fetchConfluencePageMarkdown(creds, {
    pageId,
    ...(pageUrl ? { url: pageUrl } : {}),
  });

  const siteBase = creds.baseUrl ?? fetched.restApiBase.replace(/\/rest\/api\/?$/i, "");
  const attachments = await listConfluencePageImageAttachments(fetched.restApiBase, pageId, creds);
  const assetsRel = wikiAssetsDir(categoryId, relativePath, pageId);
  const categoryRoot = join(getWikiBaseRoot(), categoryId);
  const assetsAbsDir = resolve(categoryRoot, assetsRel);
  assertUnderWikiBaseRoot(assetsAbsDir);

  const {
    saved,
    failed,
    filenames,
    buffers,
    warnings: imgWarnings,
  } = await savePageImageAttachments(siteBase, creds, attachments, assetsAbsDir);

  let textByFilename = new Map<string, string>();
  let imagesOcrRecognized = 0;
  let imagesMultimodalRecognized = 0;
  const recognizeWarnings: string[] = [];

  if (converter === "multimodal") {
    const mm = await recognizeImagesAsMarkdown(db, buffers);
    textByFilename = mm.byFilename;
    imagesMultimodalRecognized = mm.recognized;
    recognizeWarnings.push(...mm.warnings);
  } else {
    const ocrInputs: Array<{ key: string; buffer: Buffer }> = [];
    for (const [name, buf] of buffers) {
      if (shouldSkipImageOcr(name)) continue;
      ocrInputs.push({ key: name, buffer: buf });
    }
    const { results: ocrResults, warnings: ocrWarnings } = await ocrImageBuffers(ocrInputs);
    recognizeWarnings.push(...ocrWarnings);
    for (const [name, result] of ocrResults) {
      if (result.text) {
        textByFilename.set(name, result.text);
        imagesOcrRecognized += 1;
      }
    }
  }

  // 以原始文件内容为展示基础：移除对应历史块，并将图片引用解析到本地 _assets
  let displayMarkdown =
    converter === "multimodal"
      ? stripMultimodalBlocks(existing.content)
      : stripOcrBlocks(existing.content);
  displayMarkdown = rewriteMarkdownImageRefsToLocalAssets(displayMarkdown, pageId, assetsRel, filenames);
  displayMarkdown = injectBlocksAfterImages(
    displayMarkdown,
    assetsRel,
    textByFilename,
    converter === "multimodal" ? buildMultimodalBlock : buildOcrBlock,
  );

  // 识别后同步修改本地文件：将识别结果写回磁盘上的 .md 文件
  const mdAbsPath = resolve(categoryRoot, relativePath);
  assertUnderWikiBaseRoot(mdAbsPath);
  writeFileSync(mdAbsPath, displayMarkdown, "utf8");

  return {
    doc: { ...existing, content: displayMarkdown },
    display_markdown: displayMarkdown,
    images_downloaded: saved,
    images_failed: failed,
    images_ocr_recognized: imagesOcrRecognized,
    images_multimodal_recognized: imagesMultimodalRecognized,
    warnings: [...(fetched.warnings ?? []), ...imgWarnings, ...recognizeWarnings],
    converter,
  };
}
