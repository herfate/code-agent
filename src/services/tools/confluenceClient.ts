import type { DatabaseSync } from "node:sqlite";
import {
  CONFLUENCE_CONFIG_KEY_BASE_URL,
  CONFLUENCE_CONFIG_KEY_PASSWORD,
  CONFLUENCE_CONFIG_KEY_USERNAME,
} from "../../constants/systemConfigKeys.js";
import { getGlobalConfigByKey } from "../../db/systemConfig.js";
import { parseConfigStringValue } from "../dbConfig.js";
import { storageXhtmlToMarkdownWithCfxmark } from "./cfxmarkClient.js";
import { clearConfluenceTreeExportDir } from "../file/writeConfluenceMarkdown.js";

/** Confluence Server 连接凭据（Basic Auth） */
export type ConfluenceCredentials = {
  baseUrl?: string;
  username: string;
  password: string;
};

type ConfluencePageSummary = {
  pageId: string;
  title: string;
  pageUrl: string;
  spaceKey?: string;
};

export type ConfluencePageTreeScope = "children" | "descendants";

export type ConfluencePageTreeExportItem = {
  pageId: string;
  title: string;
  pageUrl: string;
  spaceKey?: string;
  warnings?: string[];
  saved_files: {
    txt: { relative_path: string; absolute_path: string };
    md: { relative_path: string; absolute_path: string };
  };
};

/** 页面树 PDF 批量导出单项 */
export type ConfluencePageTreePdfExportItem = {
  pageId: string;
  title: string;
  pageUrl: string;
  spaceKey?: string;
  saved_files: {
    pdf: { relative_path: string; absolute_path: string };
  };
};

export type ConfluencePageTreeExportError = {
  pageId: string;
  title?: string;
  message: string;
};

export type ConfluencePageTreeExportResult = {
  rootPageId: string;
  rootTitle: string;
  scope: ConfluencePageTreeScope;
  output_dir: string;
  total: number;
  saved: number;
  failed: number;
  pages: ConfluencePageTreeExportItem[];
  errors: ConfluencePageTreeExportError[];
};

export type ConfluencePageTreePdfExportResult = {
  rootPageId: string;
  rootTitle: string;
  scope: ConfluencePageTreeScope;
  output_dir: string;
  total: number;
  saved: number;
  failed: number;
  pages: ConfluencePageTreePdfExportItem[];
  errors: ConfluencePageTreeExportError[];
};

export type ConfluenceMarkdownSavePayload = {
  pageId: string;
  title: string;
  spaceKey?: string;
  pageUrl: string;
  markdown: string;
  warnings?: string[];
};

export type FetchConfluencePageOptions = {
  url?: string;
  pageId?: string;
};

/** FlyingPDF 单页 PDF 数据（页面树批量导出内部使用） */
export type ConfluencePagePdfExportResult = {
  pageId: string;
  title: string;
  pageUrl: string;
  filename: string;
  pdf: Buffer;
};

export type ExportConfluencePageTreeOptions = FetchConfluencePageOptions & {
  scope?: ConfluencePageTreeScope;
};

type ParsedConfluencePageRef = {
  pageId: string;
  restApiBase: string;
  pageUrl: string;
};

type ResolvedPageContext = {
  pageId: string;
  restApiBase: string;
  pageUrl: string;
};

type ConfluenceContentResponse = {
  title?: string;
  body?: { storage?: { value?: string } };
  space?: { key?: string };
  _links?: { webui?: string; base?: string };
};

type ConfluenceContentItem = {
  id: string;
  type?: string;
  title?: string;
  space?: { key?: string };
  _links?: { webui?: string; base?: string };
};

type ConfluencePageListResponse = {
  results?: ConfluenceContentItem[];
  size?: number;
};

/** 环境变量优先，其次全局 `system_config` */
export function resolveConfluenceCredentials(db: DatabaseSync): ConfluenceCredentials | null {
  const envUser = (process.env.CONFLUENCE_USERNAME ?? "").trim();
  const envPass = process.env.CONFLUENCE_PASSWORD ?? "";
  const envBase = (process.env.CONFLUENCE_BASE_URL ?? "").trim();

  const userRow = getGlobalConfigByKey(db, CONFLUENCE_CONFIG_KEY_USERNAME);
  const passRow = getGlobalConfigByKey(db, CONFLUENCE_CONFIG_KEY_PASSWORD);
  const baseRow = getGlobalConfigByKey(db, CONFLUENCE_CONFIG_KEY_BASE_URL);

  const username = envUser || (userRow ? parseConfigStringValue(userRow.value_json).trim() : "");
  const password = envPass !== "" ? envPass : passRow ? parseConfigStringValue(passRow.value_json) : "";
  const baseUrl = envBase || (baseRow ? parseConfigStringValue(baseRow.value_json).trim() : "");

  if (!username || password === "") return null;
  return {
    username,
    password,
    ...(baseUrl ? { baseUrl: normalizeSiteBaseUrl(baseUrl) } : {}),
  };
}

function normalizeSiteBaseUrl(input: string): string {
  const t = input.trim().replace(/\/+$/, "");
  return t.replace(/\/rest\/api\/?$/i, "");
}

function buildRestApiBase(siteBase: string): string {
  return `${normalizeSiteBaseUrl(siteBase)}/rest/api`;
}

function parseConfluencePageUrl(input: string): ParsedConfluencePageRef | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }

  const pageIdFromQuery = parsed.searchParams.get("pageId")?.trim();
  const pageIdFromPath = parsed.pathname.match(/\/pages\/(\d+)(?:\/|$)/i)?.[1];
  const pageId = pageIdFromQuery || pageIdFromPath;
  if (!pageId) return null;

  const path = parsed.pathname;
  const wikiIdx = path.indexOf("/wiki/");
  const restApiBase =
    wikiIdx >= 0
      ? `${parsed.origin}${path.slice(0, wikiIdx + "/wiki".length)}/rest/api`
      : buildRestApiBase(`${parsed.origin}${path.replace(/\/pages\/viewpage\.action$/i, "") || ""}`);

  return { pageId, restApiBase, pageUrl: parsed.toString() };
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function confluenceAuthHeaders(creds: ConfluenceCredentials): Record<string, string> {
  return {
    Authorization: basicAuthHeader(creds.username, creds.password),
    "X-Atlassian-Token": "no-check",
  };
}

/** 将 Location 相对路径解析为绝对 URL */
function resolveAbsoluteUrl(siteBase: string, location: string): string {
  const loc = location.trim();
  if (/^https?:\/\//i.test(loc)) return loc;
  const origin = new URL(normalizeSiteBaseUrl(siteBase)).origin;
  return loc.startsWith("/") ? `${origin}${loc}` : `${normalizeSiteBaseUrl(siteBase)}/${loc}`;
}

function sanitizePdfFileBaseName(title: string, pageId: string): string {
  const s = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
  return s || `confluence_${pageId}`;
}

function extractPdfFilename(
  res: Response,
  downloadUrl: string,
  title: string,
  pageId: string,
): string {
  const dispo = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(dispo);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(dispo);
  if (quoted?.[1]) return quoted[1];
  const fromPath = new URL(downloadUrl).pathname.split("/").pop();
  if (fromPath?.toLowerCase().endsWith(".pdf")) return fromPath;
  return `${sanitizePdfFileBaseName(title, pageId)}.pdf`;
}

/** 从 viewpage HTML 抓取 XSRF atl_token（部分实例导出时需要） */
async function fetchAtlToken(
  siteBase: string,
  pageId: string,
  creds: ConfluenceCredentials,
): Promise<string | null> {
  const url = `${normalizeSiteBaseUrl(siteBase)}/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
  const res = await fetch(url, {
    headers: { ...confluenceAuthHeaders(creds), Accept: "text/html" },
    signal: AbortSignal.timeout(60_000),
  });
  const html = await res.text();
  if (!res.ok) return null;
  const metaMatch = html.match(/<meta\s+name="ajs-atl-token"\s+content="([^"]+)"/i);
  if (metaMatch?.[1]) return metaMatch[1];
  const inputMatch = html.match(/<input[^>]+name="atl_token"[^>]+value="([^"]+)"/i);
  if (inputMatch?.[1]) return inputMatch[1];
  return null;
}

/**
 * FlyingPDF 拉取单页 PDF 二进制（已知 pageId / title，供页面树批量导出复用）。
 */
async function fetchConfluencePagePdfBuffer(
  siteBase: string,
  summary: ConfluencePageSummary,
  creds: ConfluenceCredentials,
): Promise<{ pdf: Buffer; filename: string }> {
  const { pageId, title } = summary;

  const triggerExport = async (withAtlToken: boolean): Promise<Response> => {
    let exportUrl = `${siteBase}/spaces/flyingpdf/pdfpageexport.action?pageId=${encodeURIComponent(pageId)}`;
    if (withAtlToken) {
      const token = await fetchAtlToken(siteBase, pageId, creds);
      if (token) exportUrl += `&atl_token=${encodeURIComponent(token)}`;
    }
    return fetch(exportUrl, {
      headers: { ...confluenceAuthHeaders(creds), Accept: "*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
    });
  };

  let exportRes = await triggerExport(false);

  if (
    exportRes.status === 403 ||
    (exportRes.status >= 400 && exportRes.status < 500) ||
    (exportRes.ok && (exportRes.headers.get("content-type") ?? "").includes("text/html"))
  ) {
    exportRes = await triggerExport(true);
  }

  let downloadUrl: string | undefined;

  if (exportRes.status === 301 || exportRes.status === 302) {
    const location = exportRes.headers.get("location");
    if (!location) {
      throw new Error("PDF 导出未返回 Location 重定向头");
    }
    downloadUrl = resolveAbsoluteUrl(siteBase, location);
  } else if (exportRes.ok) {
    const ct = exportRes.headers.get("content-type") ?? "";
    if (ct.includes("application/pdf") || ct.includes("octet-stream")) {
      const pdf = Buffer.from(await exportRes.arrayBuffer());
      return { pdf, filename: extractPdfFilename(exportRes, "", title, pageId) };
    }
  }

  if (!downloadUrl) {
    const body = await exportRes.text();
    throw new Error(`PDF 导出失败 HTTP ${exportRes.status}: ${body.slice(0, 500)}`);
  }

  const pdfRes = await fetch(downloadUrl, {
    headers: confluenceAuthHeaders(creds),
    signal: AbortSignal.timeout(180_000),
  });

  if (!pdfRes.ok) {
    const body = await pdfRes.text();
    throw new Error(`PDF 下载失败 HTTP ${pdfRes.status}: ${body.slice(0, 500)}`);
  }

  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  if (pdf.length < 5 || pdf.subarray(0, 4).toString("ascii") !== "%PDF") {
    const preview = pdf.subarray(0, 200).toString("utf8");
    throw new Error(`下载内容非 PDF 文件: ${preview.slice(0, 120)}`);
  }

  return { pdf, filename: extractPdfFilename(pdfRes, downloadUrl, title, pageId) };
}

function deriveSiteBaseFromRestApi(restApiBase: string): string {
  return normalizeSiteBaseUrl(restApiBase.replace(/\/rest\/api\/?$/i, ""));
}

function buildPageUrlFromItem(
  item: ConfluenceContentItem,
  restApiBase: string,
  creds: ConfluenceCredentials,
): string {
  const base = (item._links?.base ?? deriveSiteBaseFromRestApi(restApiBase)).replace(/\/+$/, "");
  const webui = item._links?.webui;
  if (webui) {
    return webui.startsWith("http") ? webui : `${base}${webui.startsWith("/") ? webui : `/${webui}`}`;
  }
  return `${normalizeSiteBaseUrl(creds.baseUrl ?? deriveSiteBaseFromRestApi(restApiBase))}/pages/viewpage.action?pageId=${item.id}`;
}

function resolvePageContext(
  creds: ConfluenceCredentials,
  options: FetchConfluencePageOptions,
): ResolvedPageContext {
  let pageId = options.pageId?.trim();
  let restApiBase: string | undefined;
  let pageUrl = options.url?.trim() ?? "";

  if (pageUrl) {
    const parsed = parseConfluencePageUrl(pageUrl);
    if (!parsed) {
      throw new Error("无法从 URL 解析 pageId，请使用含 /pages/{id} 或 ?pageId= 的 Confluence 链接");
    }
    pageId = parsed.pageId;
    restApiBase = parsed.restApiBase;
    pageUrl = parsed.pageUrl;
  }

  if (!pageId) {
    throw new Error("缺少 pageId 或有效的 Confluence 页面 URL");
  }

  if (!restApiBase) {
    if (!creds.baseUrl) {
      throw new Error("未配置 CONFLUENCE_BASE_URL，且 URL 未包含可推导的 REST 基址");
    }
    restApiBase = buildRestApiBase(creds.baseUrl);
  }

  return { pageId, restApiBase, pageUrl };
}

async function confluenceJsonGet<T>(
  restApiBase: string,
  path: string,
  creds: ConfluenceCredentials,
): Promise<T> {
  const url = `${restApiBase.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: {
      Authorization: basicAuthHeader(creds.username, creds.password),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Confluence HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return JSON.parse(body) as T;
}

async function listDirectChildPages(
  restApiBase: string,
  parentPageId: string,
  creds: ConfluenceCredentials,
): Promise<ConfluencePageSummary[]> {
  const all: ConfluencePageSummary[] = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const data = await confluenceJsonGet<ConfluencePageListResponse>(
      restApiBase,
      `/content/${encodeURIComponent(parentPageId)}/child/page?start=${start}&limit=${limit}`,
      creds,
    );
    const batch = data.results ?? [];
    for (const item of batch) {
      if (item.type && item.type !== "page") continue;
      all.push({
        pageId: item.id,
        title: item.title ?? "",
        pageUrl: buildPageUrlFromItem(item, restApiBase, creds),
        spaceKey: item.space?.key,
      });
    }
    const size = data.size ?? batch.length;
    if (size === 0 || size < limit) break;
    start += size;
  }

  return all;
}

/** BFS 递归拉取全部子孙（Server 7 不支持 /descendant） */
async function listAllDescendantPages(
  restApiBase: string,
  rootPageId: string,
  creds: ConfluenceCredentials,
): Promise<ConfluencePageSummary[]> {
  const all: ConfluencePageSummary[] = [];
  const seen = new Set<string>();
  const queue: string[] = [rootPageId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await listDirectChildPages(restApiBase, parentId, creds);
    for (const child of children) {
      if (seen.has(child.pageId)) continue;
      seen.add(child.pageId);
      all.push(child);
      queue.push(child.pageId);
    }
  }

  return all;
}

async function listConfluenceChildPages(
  restApiBase: string,
  parentPageId: string,
  scope: ConfluencePageTreeScope,
  creds: ConfluenceCredentials,
): Promise<ConfluencePageSummary[]> {
  if (scope === "children") {
    return listDirectChildPages(restApiBase, parentPageId, creds);
  }
  return listAllDescendantPages(restApiBase, parentPageId, creds);
}

async function fetchPageSummary(
  restApiBase: string,
  pageId: string,
  creds: ConfluenceCredentials,
  pageUrlHint?: string,
): Promise<ConfluencePageSummary> {
  const data = await confluenceJsonGet<ConfluenceContentResponse>(
    restApiBase,
    `/content/${encodeURIComponent(pageId)}?expand=space`,
    creds,
  );
  const item: ConfluenceContentItem = {
    id: pageId,
    title: data.title,
    space: data.space,
    _links: data._links,
  };
  return {
    pageId,
    title: data.title ?? "",
    pageUrl: pageUrlHint || buildPageUrlFromItem(item, restApiBase, creds),
    spaceKey: data.space?.key,
  };
}

async function fetchPageStorageMarkdown(
  restApiBase: string,
  summary: ConfluencePageSummary,
  creds: ConfluenceCredentials,
): Promise<ConfluenceMarkdownSavePayload> {
  const data = await confluenceJsonGet<ConfluenceContentResponse>(
    restApiBase,
    `/content/${encodeURIComponent(summary.pageId)}?expand=body.storage,space`,
    creds,
  );
  const storage = data.body?.storage?.value?.trim() ?? "";
  if (!storage) {
    throw new Error("页面无 body.storage 内容");
  }
  const converted = await storageXhtmlToMarkdownWithCfxmark(storage);
  return {
    pageId: summary.pageId,
    title: data.title || summary.title,
    spaceKey: data.space?.key ?? summary.spaceKey,
    pageUrl: summary.pageUrl,
    markdown: converted.markdown,
    warnings: converted.warnings,
  };
}

/**
 * 根页面 + 子孙页面批量 cfxmark 转换并保存（响应不含 markdown 正文）。
 */
export async function exportConfluencePageTreeMarkdown(
  creds: ConfluenceCredentials,
  options: ExportConfluencePageTreeOptions,
  saveFn: (
    result: ConfluenceMarkdownSavePayload,
    opts?: { subDir?: string; parentTitle?: string },
  ) => {
    txt: { relative_path: string; absolute_path: string };
    md: { relative_path: string; absolute_path: string };
  },
): Promise<ConfluencePageTreeExportResult> {
  const scope = options.scope ?? "descendants";
  const { pageId, restApiBase, pageUrl } = resolvePageContext(creds, options);
  const root = await fetchPageSummary(restApiBase, pageId, creds, pageUrl);
  const childPages = await listConfluenceChildPages(restApiBase, pageId, scope, creds);
  const targets = [root, ...childPages];
  const subDir = `tree_${pageId}`;

  clearConfluenceTreeExportDir(subDir);

  const pages: ConfluencePageTreeExportItem[] = [];
  const errors: ConfluencePageTreeExportError[] = [];

  for (const summary of targets) {
    try {
      const converted = await fetchPageStorageMarkdown(restApiBase, summary, creds);
      const saved_files = saveFn(converted, { subDir, parentTitle: root.title });
      pages.push({
        pageId: summary.pageId,
        title: converted.title,
        pageUrl: summary.pageUrl,
        spaceKey: converted.spaceKey,
        warnings: converted.warnings,
        saved_files,
      });
    } catch (e) {
      errors.push({
        pageId: summary.pageId,
        title: summary.title,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    rootPageId: root.pageId,
    rootTitle: root.title,
    scope,
    output_dir: subDir,
    total: targets.length,
    saved: pages.length,
    failed: errors.length,
    pages,
    errors,
  };
}

export type ConfluencePageTreePlainExportResult = {
  rootPageId: string;
  rootTitle: string;
  scope: ConfluencePageTreeScope;
  total: number;
  saved: number;
  failed: number;
  errors: ConfluencePageTreeExportError[];
};

/** 根页面 + 子孙批量转 Markdown，由调用方保存（不写 confluence_out、不打包） */
export async function exportConfluencePageTreeMarkdownPlain(
  creds: ConfluenceCredentials,
  options: ExportConfluencePageTreeOptions,
  onSave: (result: ConfluenceMarkdownSavePayload) => void,
): Promise<ConfluencePageTreePlainExportResult> {
  const scope = options.scope ?? "descendants";
  const { pageId, restApiBase, pageUrl } = resolvePageContext(creds, options);
  const root = await fetchPageSummary(restApiBase, pageId, creds, pageUrl);
  const childPages = await listConfluenceChildPages(restApiBase, pageId, scope, creds);
  const targets = [root, ...childPages];

  let saved = 0;
  const errors: ConfluencePageTreeExportError[] = [];

  for (const summary of targets) {
    try {
      const converted = await fetchPageStorageMarkdown(restApiBase, summary, creds);
      onSave(converted);
      saved += 1;
    } catch (e) {
      errors.push({
        pageId: summary.pageId,
        title: summary.title,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    rootPageId: root.pageId,
    rootTitle: root.title,
    scope,
    total: targets.length,
    saved,
    failed: errors.length,
    errors,
  };
}

/**
 * 根页面 + 子孙页面逐页 FlyingPDF 导出并保存（响应不含 PDF 二进制）。
 */
export async function exportConfluencePageTreePdf(
  creds: ConfluenceCredentials,
  options: ExportConfluencePageTreeOptions,
  saveFn: (
    result: ConfluencePagePdfExportResult,
    opts?: { subDir?: string; parentTitle?: string },
  ) => {
    pdf: { relative_path: string; absolute_path: string };
  },
): Promise<ConfluencePageTreePdfExportResult> {
  const scope = options.scope ?? "descendants";
  const { pageId, restApiBase, pageUrl } = resolvePageContext(creds, options);
  const siteBase = normalizeSiteBaseUrl(creds.baseUrl ?? deriveSiteBaseFromRestApi(restApiBase));
  const root = await fetchPageSummary(restApiBase, pageId, creds, pageUrl);
  const childPages = await listConfluenceChildPages(restApiBase, pageId, scope, creds);
  const targets = [root, ...childPages];
  const subDir = `tree_pdf_${pageId}`;

  clearConfluenceTreeExportDir(subDir);

  const pages: ConfluencePageTreePdfExportItem[] = [];
  const errors: ConfluencePageTreeExportError[] = [];

  for (const summary of targets) {
    try {
      const { pdf, filename } = await fetchConfluencePagePdfBuffer(siteBase, summary, creds);
      const saved_files = saveFn(
        {
          pageId: summary.pageId,
          title: summary.title,
          pageUrl: summary.pageUrl,
          pdf,
          filename,
        },
        { subDir, parentTitle: root.title },
      );
      pages.push({
        pageId: summary.pageId,
        title: summary.title,
        pageUrl: summary.pageUrl,
        spaceKey: summary.spaceKey,
        saved_files,
      });
    } catch (e) {
      errors.push({
        pageId: summary.pageId,
        title: summary.title,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    rootPageId: root.pageId,
    rootTitle: root.title,
    scope,
    output_dir: subDir,
    total: targets.length,
    saved: pages.length,
    failed: errors.length,
    pages,
    errors,
  };
}
