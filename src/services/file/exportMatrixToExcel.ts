import ExcelJS from "exceljs";

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

export interface MatrixSheet {
  /** 工作表名（不超过 31 字符） */
  sheetName: string;
  /** 表头行 */
  headers: string[];
  /** 数据行（每行为单元格字符串数组） */
  rows: string[][];
  /** 冻结首行（表头），默认 true */
  freezeHeader?: boolean;
}

/** 单行文本显示宽度（CJK 等宽字符计 2，其余计 1） */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 255 ? 2 : 1;
  }
  return w;
}

/** 列宽：该列所有单元格中最宽行的宽度 + 边距 */
function calcColumnWidths(matrix: string[][]): number[] {
  const colCount = matrix[0]?.length ?? 0;
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let maxW = 8;
    for (const row of matrix) {
      const v = row[c] ?? "";
      maxW = Math.max(maxW, ...v.split(/\r?\n/).map(displayWidth));
    }
    widths.push(Math.min(Math.max(maxW + 2, 8), 60));
  }
  return widths;
}

function applyHeaderStyle(cell: ExcelJS.Cell): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_ARGB } };
  cell.font = HEADER_FONT;
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = THIN_BORDER;
}

function applyBodyStyle(cell: ExcelJS.Cell, alignRight: boolean): void {
  cell.font = BODY_FONT;
  cell.alignment = {
    vertical: "top",
    horizontal: alignRight ? "right" : "left",
    wrapText: true,
  };
  cell.border = THIN_BORDER;
}

function buildSheet(ws: ExcelJS.Worksheet, sheet: MatrixSheet): void {
  const matrix = [sheet.headers, ...sheet.rows];
  const colWidths = calcColumnWidths(matrix);
  const freezeHeader = sheet.freezeHeader !== false;

  for (let r = 0; r < matrix.length; r++) {
    const excelRow = ws.getRow(r + 1);
    const isHeader = r === 0;
    for (let c = 0; c < matrix[r].length; c++) {
      const cell = excelRow.getCell(c + 1);
      cell.value = matrix[r][c] ?? "";
      if (isHeader) applyHeaderStyle(cell);
      else applyBodyStyle(cell, false);
    }
    excelRow.commit();
  }

  for (let c = 0; c < colWidths.length; c++) {
    ws.getColumn(c + 1).width = colWidths[c];
  }

  if (freezeHeader) {
    ws.views = [{ state: "frozen", ySplit: 1, activeCell: "A2" }];
  }
}

/** 将多个矩阵工作表打包为单个 .xlsx Buffer */
export async function matrixSheetsToExcelBuffer(sheets: MatrixSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "code-agent";
  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    let name = (sheet.sheetName || "Sheet").slice(0, 31);
    let n = 1;
    while (usedNames.has(name)) {
      const suffix = ` (${n})`;
      name = sheet.sheetName.slice(0, 31 - suffix.length) + suffix;
      n++;
    }
    usedNames.add(name);
    const ws = wb.addWorksheet(name);
    buildSheet(ws, sheet);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
