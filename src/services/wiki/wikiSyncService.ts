import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { WikiCategoryId } from "../../constants/wikiCategory.js";
import { WIKI_SOURCE_TYPE, isCodeRepoWikiSourceType, isQaApiWikiSourceType, wikiSourceTypeLabel, type WikiSourceType } from "../../constants/wikiSourceType.js";
import { listWikiSources, touchWikiSourceSyncedAt } from "../../db/wikiSource.js";
import {
  clearWikiBaseCategorySourceDir,
  saveWikiBaseMarkdownPage,
  wikiBaseCategorySourceDir,
} from "../file/writeWikiBaseMarkdown.js";
import {
  exportConfluencePageTreeMarkdownPlain,
  resolveConfluenceCredentials,
  type ConfluencePageTreeExportError,
  type ConfluencePageTreeScope,
} from "../tools/confluenceClient.js";

export type WikiSourceSyncItemResult = {
  id: string;
  source_type: string;
  source_type_label: string;
  wiki_url: string;
  /** 相对项目根，如 `wiki_base/2/基线文档` */
  output_dir: string;
  root_page_id?: string;
  root_title?: string;
  total: number;
  saved: number;
  failed: number;
  errors: ConfluencePageTreeExportError[];
  synced_at: number | null;
  skipped?: boolean;
  skip_reason?: string;
};

export type WikiCategorySyncResult = {
  category_id: WikiCategoryId;
  sources: WikiSourceSyncItemResult[];
};

function writeSyncErrorsFile(
  categoryId: WikiCategoryId,
  sourceType: WikiSourceType,
  errors: ConfluencePageTreeExportError[],
): void {
  if (errors.length === 0) return;
  const dir = wikiBaseCategorySourceDir(categoryId, sourceType);
  const lines = errors.map(
    (e) => `[${e.pageId}] ${e.title ?? ""}: ${e.message}`,
  );
  writeFileSync(join(dir, "_sync_errors.txt"), lines.join("\n") + "\n", "utf8");
}

/** 按 `wiki_source` 配置从 Confluence 拉取页面树，写入 `wiki_base/<categoryId>/<sourceType>/` */
export async function syncWikiCategoryFromConfluence(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
  options?: { scope?: ConfluencePageTreeScope },
): Promise<WikiCategorySyncResult> {
  const creds = resolveConfluenceCredentials(db);
  if (!creds) {
    throw new Error("CONFLUENCE_CREDENTIALS_MISSING");
  }

  const scope = options?.scope ?? "descendants";
  const rows = listWikiSources(db, { category_id: categoryId });
  const sources: WikiSourceSyncItemResult[] = [];

  for (const row of rows) {
    const wikiUrl = row.wiki_url.trim();
    const outputRel = `wiki_base/${categoryId}/${row.source_type}`;
    const base: WikiSourceSyncItemResult = {
      id: row.id,
      source_type: row.source_type,
      source_type_label: wikiSourceTypeLabel(row.source_type),
      wiki_url: wikiUrl,
      output_dir: outputRel,
      total: 0,
      saved: 0,
      failed: 0,
      errors: [],
      synced_at: row.synced_at,
    };

    if (isCodeRepoWikiSourceType(row.source_type)) {
      sources.push({
        ...base,
        skipped: true,
        skip_reason: "代码地址不参与 Confluence 同步",
      });
      continue;
    }

    if (isQaApiWikiSourceType(row.source_type)) {
      sources.push({
        ...base,
        skipped: true,
        skip_reason: "QA 平台类文档源通过专用接口同步",
      });
      continue;
    }

    if (!wikiUrl) {
      sources.push({
        ...base,
        skipped: true,
        skip_reason: "未配置 Confluence 地址",
      });
      continue;
    }

    clearWikiBaseCategorySourceDir(categoryId, row.source_type);

    const exported = await exportConfluencePageTreeMarkdownPlain(
      creds,
      { url: wikiUrl, scope },
      (payload) => {
        saveWikiBaseMarkdownPage(payload, categoryId, row.source_type);
      },
    );

    writeSyncErrorsFile(categoryId, row.source_type, exported.errors);

    let syncedAt: number | null = row.synced_at;
    if (exported.saved > 0) {
      const updated = touchWikiSourceSyncedAt(db, row.id);
      syncedAt = updated?.synced_at ?? Date.now();
    }

    sources.push({
      ...base,
      root_page_id: exported.rootPageId,
      root_title: exported.rootTitle,
      total: exported.total,
      saved: exported.saved,
      failed: exported.failed,
      errors: exported.errors,
      synced_at: syncedAt,
    });
  }

  return { category_id: categoryId, sources };
}
