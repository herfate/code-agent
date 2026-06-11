import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  isCodeRepoWikiSourceType,
  isConfluenceWikiSourceType,
  isQaApiWikiSourceType,
  isWikiSourceType,
  WIKI_CODE_REPO_SOURCE_TYPES,
  WIKI_SOURCE_TYPE,
  type WikiQaCodeRepoSlot,
  type WikiSourceType,
} from "../constants/wikiSourceType.js";
import { isWikiCategoryId, type WikiCategoryId } from "../constants/wikiCategory.js";

/** Wiki 文档源配置（表 `wiki_source`） */
export type WikiSourceRow = {
  id: string;
  /** 业务分类，对应 `wiki_base/<category_id>/` */
  category_id: WikiCategoryId;
  /** Confluence / Wiki 页面地址 */
  wiki_url: string;
  /** 文档源类型：`基线文档` / `迭代文档` / `spec文档` / `系统优化文档` / `自动化测试案例` / `测试脑图` / `代码地址` */
  source_type: WikiSourceType;
  /** 创建人 */
  creator: string;
  /** 最近一次同步完成时间（毫秒）；未同步过为 `null` */
  synced_at: number | null;
  created_at: number;
  updated_at: number;
};

export type CreateWikiSourceInput = {
  id?: string;
  category_id: WikiCategoryId;
  wiki_url: string;
  source_type: WikiSourceType;
  creator: string;
  synced_at?: number | null;
};

export type UpdateWikiSourcePatch = Partial<{
  wiki_url: string;
  synced_at: number | null;
}>;

function now(): number {
  return Date.now();
}

function assertWikiCategoryId(categoryId: string): asserts categoryId is WikiCategoryId {
  if (!isWikiCategoryId(categoryId)) {
    throw new Error("invalid wiki category id");
  }
}

function assertWikiSourceType(sourceType: string): asserts sourceType is WikiSourceType {
  if (!isWikiSourceType(sourceType)) {
    throw new Error("invalid wiki source type");
  }
}

const SELECT_COLUMNS = `id, category_id, wiki_url, source_type, creator, synced_at, created_at, updated_at`;

function rowFromDb(raw: WikiSourceRow | undefined): WikiSourceRow | undefined {
  return raw;
}

/** 新增 Wiki 文档源；同一 `category_id + source_type` 不可重复 */
export function createWikiSource(db: DatabaseSync, input: CreateWikiSourceInput): WikiSourceRow {
  assertWikiCategoryId(input.category_id);
  assertWikiSourceType(input.source_type);
  const creator = input.creator.trim();
  if (!creator) throw new Error("creator is required");
  const wikiUrl = input.wiki_url.trim();
  if (!wikiUrl) throw new Error("wiki_url is required");

  const t = now();
  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO wiki_source (id, category_id, wiki_url, source_type, creator, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.category_id, wikiUrl, input.source_type, creator, input.synced_at ?? null, t, t);
  return getWikiSource(db, id)!;
}

export function getWikiSource(db: DatabaseSync, id: string): WikiSourceRow | undefined {
  return rowFromDb(
    db.prepare(`SELECT ${SELECT_COLUMNS} FROM wiki_source WHERE id = ?`).get(id) as WikiSourceRow | undefined,
  );
}

/** 按分类 + 类型取唯一配置 */
export function getWikiSourceByCategoryAndType(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
  sourceType: WikiSourceType,
): WikiSourceRow | undefined {
  assertWikiCategoryId(categoryId);
  assertWikiSourceType(sourceType);
  return rowFromDb(
    db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM wiki_source WHERE category_id = ? AND source_type = ?`)
      .get(categoryId, sourceType) as WikiSourceRow | undefined,
  );
}

export type ListWikiSourcesFilter = {
  category_id?: WikiCategoryId;
  source_type?: WikiSourceType;
  creator?: string;
  limit?: number;
};

/** 列表查询；默认按分类、类型、更新时间倒序 */
export function listWikiSources(db: DatabaseSync, filter: ListWikiSourcesFilter = {}): WikiSourceRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filter.category_id !== undefined) {
    assertWikiCategoryId(filter.category_id);
    clauses.push("category_id = ?");
    params.push(filter.category_id);
  }
  if (filter.source_type !== undefined) {
    assertWikiSourceType(filter.source_type);
    clauses.push("source_type = ?");
    params.push(filter.source_type);
  }
  const creator = filter.creator?.trim();
  if (creator) {
    clauses.push("creator = ?");
    params.push(creator);
  }

  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT ${SELECT_COLUMNS} FROM wiki_source ${where}
     ORDER BY category_id ASC, source_type ASC, updated_at DESC
     LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params) as WikiSourceRow[];
}

export function updateWikiSource(db: DatabaseSync, id: string, patch: UpdateWikiSourcePatch): WikiSourceRow | undefined {
  const existing = getWikiSource(db, id);
  if (!existing) return undefined;

  const wikiUrl = patch.wiki_url !== undefined ? patch.wiki_url.trim() : existing.wiki_url;
  if (!wikiUrl) throw new Error("wiki_url is required");

  const syncedAt = patch.synced_at !== undefined ? patch.synced_at : existing.synced_at;
  const t = now();
  db.prepare(
    `UPDATE wiki_source SET wiki_url = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
  ).run(wikiUrl, syncedAt, t, id);
  return getWikiSource(db, id);
}

/** 写入同步完成时间 */
export function touchWikiSourceSyncedAt(db: DatabaseSync, id: string, syncedAt = now()): WikiSourceRow | undefined {
  return updateWikiSource(db, id, { synced_at: syncedAt });
}

export function deleteWikiSource(db: DatabaseSync, id: string): boolean {
  const r = db.prepare(`DELETE FROM wiki_source WHERE id = ?`).run(id);
  return r.changes > 0;
}

/**
 * 按分类 + 类型 upsert（用于「文档源配置」保存）。
 * 已存在则更新 `wiki_url` 与 `updated_at`，不覆盖 `creator` / `synced_at`。
 */
export function upsertWikiSourceByCategoryAndType(
  db: DatabaseSync,
  input: CreateWikiSourceInput,
): WikiSourceRow {
  const existing = getWikiSourceByCategoryAndType(db, input.category_id, input.source_type);
  if (!existing) return createWikiSource(db, input);
  const updated = updateWikiSource(db, existing.id, { wiki_url: input.wiki_url });
  return updated!;
}

/** 「文档源配置」：业务分类下的基线、迭代、系统优化、自动化测试案例、测试脑图与代码仓库地址（最多 5 个槽位） */
export type WikiDocSourceConfig = {
  baseline_doc: WikiSourceRow | null;
  requirement_iteration_doc: WikiSourceRow | null;
  system_optimization_doc: WikiSourceRow | null;
  automated_test_case: WikiSourceRow | null;
  test_mind_map: WikiSourceRow | null;
  /** 槽位 1..10，索引 0 对应代码库 1 */
  code_repos: (WikiSourceRow | null)[];
};

export function getCodeRepoRowBySlot(
  config: WikiDocSourceConfig,
  slot: WikiQaCodeRepoSlot,
): WikiSourceRow | null {
  return config.code_repos[slot - 1] ?? null;
}

/** 至少有一条 Confluence 类且 `wiki_url` 非空的文档源配置 */
export function listWikiCategoryIdsWithConfluenceConfig(db: DatabaseSync): WikiCategoryId[] {
  const rows = listWikiSources(db, { limit: 500 });
  const ids = new Set<WikiCategoryId>();
  for (const row of rows) {
    if (!isConfluenceWikiSourceType(row.source_type)) continue;
    if (!row.wiki_url.trim()) continue;
    ids.add(row.category_id);
  }
  return [...ids].sort();
}

/** 至少有一条代码库且 `wiki_url` 非空的配置 */
export function listWikiCategoryIdsWithCodeRepoConfig(db: DatabaseSync): WikiCategoryId[] {
  const rows = listWikiSources(db, { limit: 500 });
  const ids = new Set<WikiCategoryId>();
  for (const row of rows) {
    if (!isCodeRepoWikiSourceType(row.source_type)) continue;
    if (!row.wiki_url.trim()) continue;
    ids.add(row.category_id);
  }
  return [...ids].sort();
}

/** 至少有一条 QA API 类且 `wiki_url` 非空的配置 */
export function listWikiCategoryIdsWithQaTestCaseConfig(db: DatabaseSync): WikiCategoryId[] {
  const rows = listWikiSources(db, { limit: 500 });
  const ids = new Set<WikiCategoryId>();
  for (const row of rows) {
    if (!isQaApiWikiSourceType(row.source_type)) continue;
    if (!row.wiki_url.trim()) continue;
    ids.add(row.category_id);
  }
  return [...ids].sort();
}

/** Confluence、QA API 或代码库至少配置一项的分类 ID（去重并排序） */
export function listWikiCategoryIdsWithSyncConfig(db: DatabaseSync): WikiCategoryId[] {
  const ids = new Set<WikiCategoryId>([
    ...listWikiCategoryIdsWithConfluenceConfig(db),
    ...listWikiCategoryIdsWithQaTestCaseConfig(db),
    ...listWikiCategoryIdsWithCodeRepoConfig(db),
  ]);
  return [...ids].sort();
}

export function getWikiDocSourceConfigByCategory(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
): WikiDocSourceConfig {
  assertWikiCategoryId(categoryId);
  const code_repos = WIKI_CODE_REPO_SOURCE_TYPES.map(
    (sourceType) => getWikiSourceByCategoryAndType(db, categoryId, sourceType) ?? null,
  );
  return {
    baseline_doc:
      getWikiSourceByCategoryAndType(db, categoryId, WIKI_SOURCE_TYPE.BaselineDoc) ?? null,
    requirement_iteration_doc:
      getWikiSourceByCategoryAndType(db, categoryId, WIKI_SOURCE_TYPE.IterationDoc) ??
      null,
    system_optimization_doc:
      getWikiSourceByCategoryAndType(db, categoryId, WIKI_SOURCE_TYPE.SystemOptimizationDoc) ??
      null,
    automated_test_case:
      getWikiSourceByCategoryAndType(db, categoryId, WIKI_SOURCE_TYPE.AutomatedTestCase) ?? null,
    test_mind_map:
      getWikiSourceByCategoryAndType(db, categoryId, WIKI_SOURCE_TYPE.TestMindMap) ?? null,
    code_repos,
  };
}
