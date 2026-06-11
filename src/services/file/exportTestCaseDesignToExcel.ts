import ExcelJS from "exceljs";
import type { TestCaseDesignCase, TestCaseDesignColumn, TestCaseDesignDoc } from "./parseTestCaseDesignJson.js";

/** 表头背景色（Excel 标准蓝） */
const HEADER_FILL_ARGB = "FF4472C4";
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
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

/** 单行文本显示宽度（CJK 等宽字符计 2，其余计 1） */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 255 ? 2 : 1;
  }
  return w;
}

/** 单元格内最宽一行的显示宽度 */
function cellMaxLineWidth(text: string): number {
  if (!text) return 0;
  return Math.max(0, ...text.split(/\r?\n/).map(displayWidth));
}

/** 单元格有效行数（显式换行 + 列宽不足时的自动折行） */
function cellEffectiveLineCount(text: string, colWidth: number): number {
  if (!text) return 1;
  const usable = Math.max(colWidth - 1, 1);
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    const w = displayWidth(line);
    total += Math.max(1, Math.ceil(w / usable));
  }
  return Math.max(1, total);
}

/** 行高：该行各单元格有效行数的最大值 × 单行高度（pt） */
function calcRowHeights(matrix: string[][], colWidths: number[], lineHeightPt = 16): number[] {
  return matrix.map((row) => {
    let maxLines = 1;
    for (let c = 0; c < row.length; c++) {
      maxLines = Math.max(maxLines, cellEffectiveLineCount(row[c] ?? "", colWidths[c] ?? 20));
    }
    return maxLines * lineHeightPt + 4;
  });
}

/** 列宽：该列所有单元格中最宽行的宽度 + 边距 */
function calcColumnWidths(matrix: string[][]): number[] {
  const colCount = matrix[0]?.length ?? 0;
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let maxW = 8;
    for (const row of matrix) {
      maxW = Math.max(maxW, cellMaxLineWidth(row[c] ?? ""));
    }
    widths.push(Math.min(Math.max(maxW + 2, 8), 80));
  }
  return widths;
}

function cellValue(row: TestCaseDesignCase, key: string): string {
  const v = row[key];
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(String).join("\n");
  return String(v);
}

function buildMatrix(doc: TestCaseDesignDoc): { columns: TestCaseDesignColumn[]; matrix: string[][] } {
  const columns = doc.columns;
  const headers = columns.map((c) => c.header);
  const dataRows = doc.cases.map((c) => columns.map((col) => cellValue(c, col.key)));
  return { columns, matrix: [headers, ...dataRows] };
}

function applyHeaderStyle(cell: ExcelJS.Cell): void {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL_ARGB },
  };
  cell.font = HEADER_FONT;
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = THIN_BORDER;
}

function applyBodyStyle(cell: ExcelJS.Cell): void {
  cell.font = BODY_FONT;
  cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  cell.border = THIN_BORDER;
}

/** 构建工作簿（单 sheet「测试用例」） */
export async function buildTestCaseDesignWorkbook(doc: TestCaseDesignDoc): Promise<ExcelJS.Workbook> {
  const { matrix } = buildMatrix(doc);
  const colWidths = calcColumnWidths(matrix);
  const rowHeights = calcRowHeights(matrix, colWidths);

  const wb = new ExcelJS.Workbook();
  wb.creator = "code-agent";
  const ws = wb.addWorksheet("测试用例", {
    views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
  });

  for (let r = 0; r < matrix.length; r++) {
    const excelRow = ws.getRow(r + 1);
    excelRow.height = rowHeights[r];
    const isHeader = r === 0;

    for (let c = 0; c < matrix[r].length; c++) {
      const cell = excelRow.getCell(c + 1);
      cell.value = matrix[r][c];
      if (isHeader) applyHeaderStyle(cell);
      else applyBodyStyle(cell);
    }
    excelRow.commit();
  }

  for (let c = 0; c < colWidths.length; c++) {
    ws.getColumn(c + 1).width = colWidths[c];
  }

  return wb;
}

/** 导出为 `.xlsx` 二进制 */
export async function testCaseDesignToExcelBuffer(doc: TestCaseDesignDoc): Promise<Buffer> {
  const wb = await buildTestCaseDesignWorkbook(doc);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
