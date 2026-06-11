import ExcelJS from "exceljs";
import type { AutotestMdInAiOut } from "./findAutotestCaseJsonFilesInAiOut.js";
import type { AutotestCaseFileDoc, AutotestCaseItem } from "./parseAutotestCaseJson.js";

const HEADER_FILL_ARGB = "FF4472C4";
const SECTION_FILL_ARGB = "FFE9EDF4";
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
  name: "Microsoft YaHei",
};
const SECTION_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
  name: "Microsoft YaHei",
};
const BODY_FONT: Partial<ExcelJS.Font> = {
  size: 11,
  name: "Microsoft YaHei",
};
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D7E2" } },
  left: { style: "thin", color: { argb: "FFD0D7E2" } },
  bottom: { style: "thin", color: { argb: "FFD0D7E2" } },
  right: { style: "thin", color: { argb: "FFD0D7E2" } },
};

/** 用例主字段 → 页面中文 */
const CASE_FIELD_LABELS: Record<string, string> = {
  title: "用例名称",
  describe: "用例描述",
  labelNames: "用例标签",
  parallelStatus: "案例并行",
  delivers: "参数传递",
  caseMockCode: "mock透传码",
  order: "执行顺序",
  scriptId: "脚本ID",
  id: "案例ID",
  caseAssertCount: "数据验证",
  caseDataOperationCount: "数据操作",
};

type SheetRow = { kind: "header" | "section" | "data"; col1: string; col2: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 将 JSON 对象扁平化为 dot 路径键 */
function flattenJson(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || value === undefined) {
    out[prefix || "value"] = "";
    return out;
  }
  if (Array.isArray(value)) {
    out[prefix || "value"] = JSON.stringify(value);
    return out;
  }
  if (!isRecord(value)) {
    out[prefix || "value"] = String(value);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenJson(v, key));
    } else {
      out[key] =
        v === null || v === undefined ? "" : Array.isArray(v) ? JSON.stringify(v) : String(v);
    }
  }
  return out;
}

function parseJsonString(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

function formatParallel(v: boolean | null): string {
  if (v === null) return "";
  return v ? "是" : "否";
}

function buildCaseRows(item: AutotestCaseItem, caseIndex: number, caseCount: number): SheetRow[] {
  const rows: SheetRow[] = [];
  if (caseCount > 1) {
    rows.push({
      kind: "section",
      col1: `【用例 ${caseIndex + 1}/${caseCount}】`,
      col2: item.title,
    });
  }

  rows.push({ kind: "section", col1: "【用例基本信息】", col2: "" });
  const basics: [string, string][] = [
    [CASE_FIELD_LABELS.title, item.title],
    [CASE_FIELD_LABELS.describe, item.describe ?? ""],
    [CASE_FIELD_LABELS.labelNames, item.labelNames.join(", ")],
    [CASE_FIELD_LABELS.parallelStatus, formatParallel(item.parallelStatus)],
    [CASE_FIELD_LABELS.delivers, item.delivers ?? ""],
    [CASE_FIELD_LABELS.caseMockCode, item.caseMockCode ?? ""],
    [CASE_FIELD_LABELS.order, item.order != null ? String(item.order) : ""],
    [CASE_FIELD_LABELS.scriptId, item.scriptId != null ? String(item.scriptId) : ""],
    [CASE_FIELD_LABELS.id, item.id != null ? String(item.id) : ""],
    [CASE_FIELD_LABELS.caseAssertCount, item.caseAssertCount ?? ""],
    [CASE_FIELD_LABELS.caseDataOperationCount, item.caseDataOperationCount ?? ""],
  ];
  for (const [label, val] of basics) {
    rows.push({ kind: "data", col1: label, col2: val });
  }

  rows.push({ kind: "section", col1: "【输入请求】", col2: "" });
  rows.push({ kind: "data", col1: "input", col2: item.input });

  rows.push({ kind: "section", col1: "【预期返回】", col2: "" });
  const expectFlat = flattenJson(parseJsonString(item.expect));
  for (const [k, v] of Object.entries(expectFlat)) {
    rows.push({ kind: "data", col1: k, col2: v });
  }

  return rows;
}

function buildSheetRows(doc: AutotestCaseFileDoc): SheetRow[] {
  const rows: SheetRow[] = [{ kind: "header", col1: "字段", col2: "值" }];
  doc.cases.forEach((item, idx) => {
    if (idx > 0) {
      rows.push({ kind: "data", col1: "", col2: "" });
    }
    rows.push(...buildCaseRows(item, idx, doc.cases.length));
  });
  return rows;
}

function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 255 ? 2 : 1;
  }
  return w;
}

function cellMaxLineWidth(text: string): number {
  if (!text) return 0;
  return Math.max(0, ...text.split(/\r?\n/).map(displayWidth));
}

function calcColumnWidths(matrix: string[][]): number[] {
  const colCount = matrix[0]?.length ?? 0;
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let maxW = 8;
    for (const row of matrix) {
      maxW = Math.max(maxW, cellMaxLineWidth(row[c] ?? ""));
    }
    widths.push(Math.min(Math.max(maxW + 2, 10), 80));
  }
  return widths;
}

function applyHeaderStyle(cell: ExcelJS.Cell): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_ARGB } };
  cell.font = HEADER_FONT;
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = THIN_BORDER;
}

function applySectionStyle(cell: ExcelJS.Cell): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL_ARGB } };
  cell.font = SECTION_FONT;
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  cell.border = THIN_BORDER;
}

function applyBodyStyle(cell: ExcelJS.Cell): void {
  cell.font = BODY_FONT;
  cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  cell.border = THIN_BORDER;
}

/** Excel sheet 名：取文件名（无扩展名），最长 31 字符，去除非法字符 */
export function autotestCaseSheetName(relativePath: string, used: Set<string>): string {
  const base =
    relativePath
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.json$/i, "")
      .replace(/[*?:/\\[\]]/g, "_")
      .trim() || "case";
  let name = base.slice(0, 31);
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (i < 1000) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    i += 1;
  }
  const fallback = `case_${used.size + 1}`.slice(0, 31);
  used.add(fallback);
  return fallback;
}

function writeSheet(ws: ExcelJS.Worksheet, doc: AutotestCaseFileDoc): void {
  const sheetRows = buildSheetRows(doc);
  const matrix = sheetRows.map((r) => [r.col1, r.col2]);
  const colWidths = calcColumnWidths(matrix);

  for (let r = 0; r < sheetRows.length; r++) {
    const rowMeta = sheetRows[r];
    const excelRow = ws.getRow(r + 1);
    excelRow.height = rowMeta.kind === "header" ? 22 : 18;
    for (let c = 0; c < 2; c++) {
      const cell = excelRow.getCell(c + 1);
      cell.value = matrix[r][c];
      if (rowMeta.kind === "header") applyHeaderStyle(cell);
      else if (rowMeta.kind === "section") applySectionStyle(cell);
      else applyBodyStyle(cell);
    }
    excelRow.commit();
  }

  ws.getColumn(1).width = colWidths[0] ?? 24;
  ws.getColumn(2).width = colWidths[1] ?? 48;
  ws.views = [{ state: "frozen", ySplit: 1, activeCell: "A2" }];
}

const MD_SHEET_NAME = "案例清单";

/** 将 Markdown 原文写入 sheet（多文件时用分节标题分隔） */
function writeMarkdownSheet(ws: ExcelJS.Worksheet, mdDocs: AutotestMdInAiOut[]): void {
  let rowNum = 1;
  const multi = mdDocs.length > 1;

  for (let i = 0; i < mdDocs.length; i++) {
    const doc = mdDocs[i];
    if (multi) {
      const sepRow = ws.getRow(rowNum++);
      const sepCell = sepRow.getCell(1);
      sepCell.value = `【${doc.relative_path}】`;
      applySectionStyle(sepCell);
      sepRow.height = 20;
    }

    const lines = doc.content.split(/\r?\n/);
    if (lines.length === 0) {
      const emptyRow = ws.getRow(rowNum++);
      emptyRow.getCell(1).value = "";
      applyBodyStyle(emptyRow.getCell(1));
    }
    for (const line of lines) {
      const row = ws.getRow(rowNum++);
      const cell = row.getCell(1);
      cell.value = line;
      applyBodyStyle(cell);
      row.height = line.trim() === "" ? 8 : 16;
    }

    if (multi && i < mdDocs.length - 1) {
      rowNum += 1;
    }
  }

  ws.getColumn(1).width = 100;
  ws.views = [{ activeCell: "A1" }];
}

/** 多文件 → 多 sheet 工作簿（可选首个 sheet 写入 Markdown 清单） */
export async function buildAutotestCaseWorkbook(
  files: AutotestCaseFileDoc[],
  mdFiles: AutotestMdInAiOut[] = [],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "code-agent";
  const usedNames = new Set<string>();

  if (mdFiles.length > 0) {
    usedNames.add(MD_SHEET_NAME);
    const mdWs = wb.addWorksheet(MD_SHEET_NAME);
    writeMarkdownSheet(mdWs, mdFiles);
  }

  for (const doc of files) {
    const sheetName = autotestCaseSheetName(doc.relative_path, usedNames);
    const ws = wb.addWorksheet(sheetName);
    writeSheet(ws, doc);
  }
  return wb;
}

/** 导出为 `.xlsx` 二进制 */
export async function autotestCaseToExcelBuffer(
  files: AutotestCaseFileDoc[],
  mdFiles: AutotestMdInAiOut[] = [],
): Promise<Buffer> {
  const wb = await buildAutotestCaseWorkbook(files, mdFiles);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
