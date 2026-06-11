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
import { sanitizeWikiDirName, saveWikiBaseJsonFile } from "../file/writeWikiBaseJson.js";
import { qaPostRaw } from "../tools/qaPlatformClient.js";
import { parseQaTestSetWikiUrls } from "./qaTestSetWikiSource.js";

const PAGE_SIZE = 50;

type QaApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type TestSetScriptItem = {
  id: number;
  scriptId: number;
  orderNum?: number;
  title?: string;
  apiName?: string;
  [key: string]: unknown;
};

type OrderedScript = TestSetScriptItem & {
  testSetId: string;
  /** 全局排序序号（从 1 起，用于目录前缀） */
  seq: number;
};

type ScriptCaseListItem = {
  id?: number;
  order?: number;
  title?: string;
  scriptCaseVo?: {
    id?: number;
    order?: number;
    title?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type PagedList<T> = {
  pageNum?: number;
  pageSize?: number;
  total?: number;
  list?: T[];
};

export type QaTestCaseSyncError = {
  scriptId: string;
  title?: string;
  message: string;
};

export type QaTestCaseSyncItemResult = {
  id: string;
  source_type: string;
  source_type_label: string;
  wiki_url: string;
  test_set_id?: string;
  output_dir: string;
  total_scripts: number;
  saved_scripts: number;
  failed_scripts: number;
  errors: QaTestCaseSyncError[];
  synced_at: number | null;
  skipped?: boolean;
  skip_reason?: string;
};

export type WikiCategoryQaTestCaseSyncResult = {
  category_id: WikiCategoryId;
  sources: QaTestCaseSyncItemResult[];
};

function parseQaResponse<T>(raw: string, label: string): QaApiResponse<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${label} 非 JSON 响应`);
  }
  const resp = json as QaApiResponse<T>;
  if (resp.code !== 200) {
    throw new Error(`${label} 失败: ${resp.message ?? raw.slice(0, 240)}`);
  }
  return resp;
}

async function fetchAllPaged<T>(
  creds: NonNullable<ReturnType<typeof getQaCredentials>>,
  path: string,
  buildBody: (pageNum: number, pageSize: number) => string,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  let pageNum = 1;
  while (true) {
    const raw = await qaPostRaw(creds, path, buildBody(pageNum, PAGE_SIZE));
    const resp = parseQaResponse<PagedList<T>>(raw, label);
    const list = resp.data?.list ?? [];
    all.push(...list);
    const total = resp.data?.total ?? all.length;
    if (pageNum * PAGE_SIZE >= total || list.length === 0) break;
    pageNum += 1;
  }
  return all;
}

/** 目录名前缀序号，至少 2 位（01、02…） */
function formatScriptDirSeq(seq: number, total: number): string {
  const width = Math.max(2, String(total).length);
  return String(seq).padStart(width, "0");
}

function buildScriptDirName(seq: number, total: number, title: string, scriptId: string): string {
  return buildSeqTitleName(seq, total, title, `script_${scriptId}`);
}

async function fetchTestSetScripts(
  creds: NonNullable<ReturnType<typeof getQaCredentials>>,
  testSetId: string,
): Promise<TestSetScriptItem[]> {
  const scripts = await fetchAllPaged<TestSetScriptItem>(
    creds,
    "/qa-info/getTestSetScriptList",
    (pageNum, pageSize) =>
      JSON.stringify({
        pageNum,
        pageSize,
        data: { testSetId },
      }),
    "getTestSetScriptList",
  );
  return scripts.sort((a, b) => {
    const ao = typeof a.orderNum === "number" ? a.orderNum : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.orderNum === "number" ? b.orderNum : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.scriptId ?? "").localeCompare(String(b.scriptId ?? ""));
  });
}

function buildSeqTitleName(seq: number, total: number, title: string, fallback: string): string {
  const prefix = formatScriptDirSeq(seq, total);
  const base = sanitizeWikiDirName(title, fallback);
  return `${prefix}_${base}`;
}

function resolveCaseOrder(item: ScriptCaseListItem): number {
  if (typeof item.order === "number") return item.order;
  const voOrder = item.scriptCaseVo?.order;
  if (typeof voOrder === "number") return voOrder;
  return Number.MAX_SAFE_INTEGER;
}

function resolveCaseTitle(item: ScriptCaseListItem): string {
  const t = item.title ?? item.scriptCaseVo?.title;
  return t != null ? String(t) : "";
}

function resolveCaseId(item: ScriptCaseListItem): string {
  const id = item.id ?? item.scriptCaseVo?.id;
  return id != null ? String(id) : "";
}

function sortScriptCases(cases: ScriptCaseListItem[]): ScriptCaseListItem[] {
  return [...cases].sort((a, b) => {
    const ao = resolveCaseOrder(a);
    const bo = resolveCaseOrder(b);
    if (ao !== bo) return ao - bo;
    return resolveCaseId(a).localeCompare(resolveCaseId(b));
  });
}

/** 将用例列表按序号 + title 拆成多个 JSON 文件（每项保留完整 API 响应结构） */
function saveScriptCasesAsFiles(
  categoryId: WikiCategoryId,
  sourceType: WikiSourceType,
  scriptDirName: string,
  cases: ScriptCaseListItem[],
): void {
  const sorted = sortScriptCases(cases);
  const total = sorted.length;
  const usedNames = new Set<string>();

  sorted.forEach((caseItem, idx) => {
    const seq = idx + 1;
    const caseId = resolveCaseId(caseItem);
    const title = resolveCaseTitle(caseItem);
    let fileBase = buildSeqTitleName(seq, total, title, caseId ? `case_${caseId}` : `case_${seq}`);
    if (usedNames.has(fileBase)) {
      fileBase = caseId ? `${fileBase}_${caseId}` : `${fileBase}_${seq}`;
    }
    usedNames.add(fileBase);

    saveWikiBaseJsonFile(categoryId, sourceType, scriptDirName, `${fileBase}.json`, {
      code: 200,
      message: "success",
      data: {
        list: [caseItem],
        total: 1,
      },
    });
  });
}

function writeSyncErrorsFile(
  categoryId: WikiCategoryId,
  sourceType: WikiSourceType,
  errors: QaTestCaseSyncError[],
): void {
  if (errors.length === 0) return;
  const dir = wikiBaseCategorySourceDir(categoryId, sourceType);
  const lines = errors.map((e) => `[${e.scriptId}] ${e.title ?? ""}: ${e.message}`);
  writeFileSync(join(dir, "_sync_errors.txt"), lines.join("\n") + "\n", "utf8");
}

async function syncOneQaTestCaseRow(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
  row: WikiSourceRow,
  creds: NonNullable<ReturnType<typeof getQaCredentials>>,
): Promise<QaTestCaseSyncItemResult> {
  const wikiUrl = row.wiki_url.trim();
  const outputRel = `wiki_base/${categoryId}/${row.source_type}`;
  const base: QaTestCaseSyncItemResult = {
    id: row.id,
    source_type: row.source_type,
    source_type_label: wikiSourceTypeLabel(row.source_type),
    wiki_url: wikiUrl,
    output_dir: outputRel,
    total_scripts: 0,
    saved_scripts: 0,
    failed_scripts: 0,
    errors: [],
    synced_at: row.synced_at,
  };

  const testSetIds = parseQaTestSetWikiUrls(wikiUrl);
  if (testSetIds.length === 0) {
    return { ...base, skipped: true, skip_reason: "未配置 testSetId" };
  }

  clearWikiBaseCategorySourceDir(categoryId, row.source_type);

  const scripts: OrderedScript[] = [];
  for (const testSetId of testSetIds) {
    const list = await fetchTestSetScripts(creds, testSetId);
    for (const script of list) {
      scripts.push({ ...script, testSetId, seq: 0 });
    }
  }
  scripts.forEach((script, idx) => {
    script.seq = idx + 1;
  });

  const usedDirNames = new Set<string>();
  const errors: QaTestCaseSyncError[] = [];
  let savedScripts = 0;
  const total = scripts.length;

  for (const script of scripts) {
    const scriptId = String(script.scriptId ?? "");
    const title = String(script.title || script.apiName || scriptId);
    if (!scriptId) {
      errors.push({ scriptId: "?", title, message: "缺少 scriptId" });
      continue;
    }

    let dirName = buildScriptDirName(script.seq, total, title, scriptId);
    if (usedDirNames.has(dirName)) {
      dirName = `${dirName}_${scriptId}`;
    }
    usedDirNames.add(dirName);

    try {
      saveWikiBaseJsonFile(categoryId, row.source_type, dirName, "script.json", script);

      const allCases = await fetchAllPaged<ScriptCaseListItem>(
        creds,
        "/qa-info/scriptCase/queryListByScriptId",
        (pageNum, pageSize) =>
          JSON.stringify({
            pageNum,
            pageSize,
            data: {
              scriptId,
              caseId: "",
              caseName: "",
              labelId: "",
              parallelStatus: null,
              haveDataOperate: null,
              aiPrefix: "",
            },
          }),
        "queryListByScriptId",
      );
      saveScriptCasesAsFiles(categoryId, row.source_type, dirName, allCases);

      savedScripts += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ scriptId, title, message });
    }
  }

  writeSyncErrorsFile(categoryId, row.source_type, errors);

  let syncedAt: number | null = row.synced_at;
  if (savedScripts > 0) {
    const updated = touchWikiSourceSyncedAt(db, row.id);
    syncedAt = updated?.synced_at ?? Date.now();
  }

  return {
    ...base,
    test_set_id: testSetIds.join(","),
    total_scripts: scripts.length,
    saved_scripts: savedScripts,
    failed_scripts: errors.length,
    errors,
    synced_at: syncedAt,
  };
}

/** 按 `wiki_source` 配置从 QA 平台拉取测试集脚本与用例，写入 `wiki_base/<categoryId>/自动化测试案例/` */
export async function syncWikiCategoryQaTestCases(
  db: DatabaseSync,
  categoryId: WikiCategoryId,
): Promise<WikiCategoryQaTestCaseSyncResult> {
  const creds = getQaCredentials(db);
  if (!creds) {
    throw new Error("QA_CREDENTIALS_MISSING");
  }

  const row = getWikiSourceByCategoryAndType(
    db,
    categoryId,
    WIKI_SOURCE_TYPE.AutomatedTestCase,
  );
  const sources: QaTestCaseSyncItemResult[] = [];

  if (!row) {
    sources.push({
      id: "",
      source_type: WIKI_SOURCE_TYPE.AutomatedTestCase,
      source_type_label: wikiSourceTypeLabel(WIKI_SOURCE_TYPE.AutomatedTestCase),
      wiki_url: "",
      output_dir: `wiki_base/${categoryId}/${WIKI_SOURCE_TYPE.AutomatedTestCase}`,
      total_scripts: 0,
      saved_scripts: 0,
      failed_scripts: 0,
      errors: [],
      synced_at: null,
      skipped: true,
      skip_reason: "未配置",
    });
    return { category_id: categoryId, sources };
  }

  sources.push(await syncOneQaTestCaseRow(db, categoryId, row, creds));
  return { category_id: categoryId, sources };
}
