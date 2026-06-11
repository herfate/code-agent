import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { WikiCategoryId } from "../../constants/wikiCategory.js";
import {
  WIKI_SOURCE_TYPE,
  wikiSourceTypeLabel,
  type WikiSourceType,
} from "../../constants/wikiSourceType.js";
import {
  getWikiSourceByCategoryAndType,
  touchWikiSourceSyncedAt,
  type WikiSourceRow,
} from "../../db/wikiSource.js";
import { getQaCredentials } from "../dbConfig.js";
import { clearWikiBaseCategorySourceDir, wikiBaseCategorySourceDir } from "../file/writeWikiBaseMarkdown.js";
import { saveWikiBaseJsonFile } from "../file/writeWikiBaseJson.js";
import { qaGetData } from "../tools/qaPlatformClient.js";
import { parseQaTestMindMapWikiUrls } from "./qaTestMindMapWikiSource.js";

type RawBusinessNode = {
  biz_name?: unknown;
  children?: unknown;
};

export type BizNameTreeNode = {
  biz_name: string;
  children: BizNameTreeNode[];
};

export type QaTestMindMapSyncError = {
  biz_id: string;
  message: string;
};

export type QaTestMindMapSyncItemResult = {
  id: string;
  source_type: string;
  source_type_label: string;
  wiki_url: string;
  biz_ids?: string;
  output_dir: string;
  total_trees: number;
  saved_trees: number;
  failed_trees: number;
  errors: QaTestMindMapSyncError[];
  synced_at: number | null;
  skipped?: boolean;
  skip_reason?: string;
};

export type WikiCategoryQaTestMindMapSyncResult = {
  category_id: WikiCategoryId;
  sources: QaTestMindMapSyncItemResult[];
};

function stripToBizNameTree(node: RawBusinessNode): BizNameTreeNode {
  const childrenRaw = node.children;
  const children = Array.isArray(childrenRaw)
    ? childrenRaw.map((item) => stripToBizNameTree((item ?? {}) as RawBusinessNode))
    : [];
  return {
    biz_name: node.biz_name != null ? String(node.biz_name) : "",
    children,
  };
}

function stripForest(nodes: unknown): BizNameTreeNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((item) => stripToBizNameTree((item ?? {}) as RawBusinessNode));
}

function writeSyncErrorsFile(
  categoryId: WikiCategoryId,
  sourceType: WikiSourceType,
  errors: QaTestMindMapSyncError[],
): void {
  if (errors.length === 0) return;
  const dir = wikiBaseCategorySourceDir(categoryId, sourceType);
  const lines = errors.map((e) => `[${e.biz_id}] ${e.message}`);
  writeFileSync(join(dir, "_sync_errors.txt"), lines.join("\n") + "\n", "utf8");
}

async function fetchBusinessTree(
  creds: NonNullable<ReturnType<typeof getQaCredentials>>,
  bizId: string,
  bizType: string,
): Promise<BizNameTreeNode[]> {
  const query = new URLSearchParams({ bizId, bizType });
  const data = await qaGetData(creds, `/qa-info/business/business_info/?${query.toString()}`);
  return stripForest(data);
}

async function syncOneQaTestMindMapRow(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
  row: WikiSourceRow,
  creds: NonNullable<ReturnType<typeof getQaCredentials>>,
): Promise<QaTestMindMapSyncItemResult> {
  const wikiUrl = row.wiki_url.trim();
  const outputRel = `wiki_base/${categoryId}/${row.source_type}`;
  const base: QaTestMindMapSyncItemResult = {
    id: row.id,
    source_type: row.source_type,
    source_type_label: wikiSourceTypeLabel(row.source_type),
    wiki_url: wikiUrl,
    output_dir: outputRel,
    total_trees: 0,
    saved_trees: 0,
    failed_trees: 0,
    errors: [],
    synced_at: row.synced_at,
  };

  const configs = parseQaTestMindMapWikiUrls(wikiUrl);
  if (configs.length === 0) {
    return { ...base, skipped: true, skip_reason: "未配置 bizId" };
  }

  clearWikiBaseCategorySourceDir(categoryId, row.source_type);

  const errors: QaTestMindMapSyncError[] = [];
  let savedTrees = 0;

  for (const { bizId, bizType } of configs) {
    try {
      const tree = await fetchBusinessTree(creds, bizId, bizType);
      saveWikiBaseJsonFile(categoryId, row.source_type, "", `${bizId}.json`, tree);
      savedTrees += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ biz_id: bizId, message });
    }
  }

  writeSyncErrorsFile(categoryId, row.source_type, errors);

  let syncedAt: number | null = row.synced_at;
  if (savedTrees > 0) {
    const updated = touchWikiSourceSyncedAt(db, row.id);
    syncedAt = updated?.synced_at ?? Date.now();
  }

  return {
    ...base,
    biz_ids: configs.map((c) => c.bizId).join(","),
    total_trees: configs.length,
    saved_trees: savedTrees,
    failed_trees: errors.length,
    errors,
    synced_at: syncedAt,
  };
}

/** 按 `wiki_source` 配置从 QA 平台拉取业务树，写入 `wiki_base/<categoryId>/测试脑图/`（仅保留 `biz_name`） */
export async function syncWikiCategoryQaTestMindMaps(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
): Promise<WikiCategoryQaTestMindMapSyncResult> {
  const creds = getQaCredentials(db);
  if (!creds) {
    throw new Error("QA_CREDENTIALS_MISSING");
  }

  const row = getWikiSourceByCategoryAndType(db, categoryId, WIKI_SOURCE_TYPE.TestMindMap);
  const sources: QaTestMindMapSyncItemResult[] = [];

  if (!row) {
    sources.push({
      id: "",
      source_type: WIKI_SOURCE_TYPE.TestMindMap,
      source_type_label: wikiSourceTypeLabel(WIKI_SOURCE_TYPE.TestMindMap),
      wiki_url: "",
      output_dir: `wiki_base/${categoryId}/${WIKI_SOURCE_TYPE.TestMindMap}`,
      total_trees: 0,
      saved_trees: 0,
      failed_trees: 0,
      errors: [],
      synced_at: null,
      skipped: true,
      skip_reason: "未配置",
    });
    return { category_id: categoryId, sources };
  }

  sources.push(await syncOneQaTestMindMapRow(db, categoryId, row, creds));
  return { category_id: categoryId, sources };
}
