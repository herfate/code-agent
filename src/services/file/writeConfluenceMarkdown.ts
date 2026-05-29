import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { CONFLUENCE_OUT_DIR } from "../../constants/commonKey.js";
import type {
  ConfluenceMarkdownSavePayload,
  ConfluencePagePdfExportResult,
  ConfluencePageTreeExportError,
} from "../tools/confluenceClient.js";

export type SavedConfluencePageFile = {
  relative_path: string;
  absolute_path: string;
};

export type SavedConfluencePageFiles = {
  txt: SavedConfluencePageFile;
  md: SavedConfluencePageFile;
};

export type SavedConfluencePagePdfFiles = {
  pdf: SavedConfluencePageFile;
};

export function getConfluenceOutRoot(): string {
  const fromEnv = (process.env.CONFLUENCE_OUTPUT_DIR ?? "").trim();
  return resolve(process.cwd(), fromEnv || CONFLUENCE_OUT_DIR);
}

function assertSafePageId(pageId: string): void {
  if (!/^\d+$/.test(pageId)) {
    throw new Error("invalid pageId");
  }
}

function assertUnderOutRoot(absPath: string): void {
  const root = getConfluenceOutRoot();
  const normalized = resolve(absPath);
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error("path outside confluence output dir");
  }
}

function sanitizeFileBaseName(title: string, fallback: string): string {
  const s = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
  return s || fallback;
}

function buildPageDocument(result: ConfluenceMarkdownSavePayload): string {
  const meta = [
    `Confluence pageId: ${result.pageId}`,
    result.spaceKey ? `space: ${result.spaceKey}` : "",
    `source: ${result.pageUrl}`,
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta}${result.markdown}\n`;
}

function writePageFile(outDir: string, fileName: string, content: string): SavedConfluencePageFile {
  mkdirSync(outDir, { recursive: true });
  const absolute_path = join(outDir, fileName);
  assertUnderOutRoot(absolute_path);
  writeFileSync(absolute_path, content, "utf8");
  return {
    absolute_path,
    relative_path: relative(process.cwd(), absolute_path).replace(/\\/g, "/"),
  };
}

/** 导出前清空 `confluence_out/{subDir}/` 及同级 `{subDir}.zip` */
export function clearConfluenceTreeExportDir(subDir: string): void {
  const t = subDir.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!t || !/^[a-zA-Z0-9_-]+$/.test(t)) {
    throw new Error("invalid subDir");
  }
  const root = getConfluenceOutRoot();
  const treeDir = join(root, t);
  const zipPath = join(root, `${t}.zip`);
  assertUnderOutRoot(treeDir);
  assertUnderOutRoot(zipPath);
  rmSync(treeDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
}

/**
 * 写入 `{subDir}/{父页面名}_txt/` 与 `{subDir}/{父页面名}_md/`，内容相同，仅扩展名不同。
 */
export function saveConfluencePageExport(
  result: ConfluenceMarkdownSavePayload,
  options?: { subDir?: string; parentTitle?: string },
): SavedConfluencePageFiles {
  assertSafePageId(result.pageId);

  const root = getConfluenceOutRoot();
  const subDir = options?.subDir?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (subDir && !/^[a-zA-Z0-9_-]+$/.test(subDir)) {
    throw new Error("invalid subDir");
  }
  const treeDir = subDir ? join(root, subDir) : root;
  const content = buildPageDocument(result);
  const baseName = sanitizeFileBaseName(result.title, `page_${result.pageId}`);
  const stem = `${result.pageId}_${baseName}`;
  const parentBase = sanitizeFileBaseName(
    options?.parentTitle ?? "",
    subDir?.replace(/^tree_/, "page_") ?? `page_${result.pageId}`,
  );

  return {
    txt: writePageFile(join(treeDir, `${parentBase}_txt`), `${stem}.txt`, content),
    md: writePageFile(join(treeDir, `${parentBase}_md`), `${stem}.md`, content),
  };
}

/** 写入 `{subDir}/{父页面名}_pdf/{pageId}_{标题}.pdf` */
export function saveConfluencePagePdfExport(
  result: ConfluencePagePdfExportResult,
  options?: { subDir?: string; parentTitle?: string },
): SavedConfluencePagePdfFiles {
  assertSafePageId(result.pageId);

  const root = getConfluenceOutRoot();
  const subDir = options?.subDir?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (subDir && !/^[a-zA-Z0-9_-]+$/.test(subDir)) {
    throw new Error("invalid subDir");
  }
  const treeDir = subDir ? join(root, subDir) : root;
  const baseName = sanitizeFileBaseName(result.title, `page_${result.pageId}`);
  const fileName = `${result.pageId}_${baseName}.pdf`;
  const parentBase = sanitizeFileBaseName(
    options?.parentTitle ?? "",
    subDir?.replace(/^tree_pdf_/, "page_") ?? `page_${result.pageId}`,
  );
  const outDir = join(treeDir, `${parentBase}_pdf`);

  mkdirSync(outDir, { recursive: true });
  const absolute_path = join(outDir, fileName);
  assertUnderOutRoot(absolute_path);
  writeFileSync(absolute_path, result.pdf);

  return {
    pdf: {
      absolute_path,
      relative_path: relative(process.cwd(), absolute_path).replace(/\\/g, "/"),
    },
  };
}

/** 导出失败清单（写在树目录根下，随 zip 下载） */
export function writeConfluenceExportErrorsFile(
  subDir: string,
  errors: ConfluencePageTreeExportError[],
): void {
  if (errors.length === 0) return;

  const outDir = join(getConfluenceOutRoot(), subDir);
  mkdirSync(outDir, { recursive: true });
  const lines = errors.map(
    (e) => [e.pageId, e.title ?? "", e.message].join("\t"),
  );
  const content = ["pageId\ttitle\tmessage", ...lines].join("\n");
  writeFileSync(join(outDir, "_export_errors.txt"), `${content}\n`, "utf8");
}
