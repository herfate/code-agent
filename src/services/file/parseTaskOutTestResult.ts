import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 解析后的测试结果（通过率、总结简述）及来源文件 */
export type ParsedTaskOutPassRate = {
  passRate: number;
  /** `测试总结简述`；缺失时为 `undefined` */
  summary?: string;
  /** `是否代码问题`；未解析到时为 `undefined` */
  isCodeProblem?: boolean;
  /** `是否因外部dubbo接口阻塞`；未解析到时为 `undefined` */
  isBlockedByExternalDubbo?: boolean;
  sourceFile: string;
  /** 来源文件全文（写入重试开发任务 description，便于下次续跑持久化） */
  reportContent: string;
};

/** 解析「是/否」类字段（支持 是、否、yes、no、true、false；容许 `**是**` 等 Markdown 加粗/斜体/行内代码）；容许值后接括号等说明文字 */
export function parseYesNoField(raw: string | null | undefined): boolean | null {
  if (raw == null) return null;
  // 去掉 Markdown 强调/行内代码标记，如 **是**、*否*、`yes`
  const t = raw.trim().replace(/[*_`]+/g, "").trim().toLowerCase();
  if (t.startsWith("是") || t === "yes" || t === "true" || t === "1") return true;
  if (t.startsWith("否") || t === "no" || t === "false" || t === "0") return false;
  return null;
}

const TEST_RESULT_HEADING = "测试结果";

/** 从百分比字符串（如 `85%`、`85.5%（21/22，...）`）解析数值；无法解析时返回 `null` */
export function parsePassRatePercent(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (t === "") return null;
  // 提取首个「数字 + %」，容许其后附带括号说明等文字
  const m = t.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** 取待解析正文：有 `测试结果` 时仅用其后内容 */
function sliceTestResultText(content: string): string {
  const idx = content.indexOf(TEST_RESULT_HEADING);
  if (idx < 0) return content;
  return content.slice(idx + TEST_RESULT_HEADING.length);
}

/** 去掉 Markdown 行内代码反引号，如 `` `85%` `` → `85%` */
function normalizeTestResultCellValue(raw: string): string {
  const t = raw.trim();
  const m = /^`([^`]*)`$/.exec(t);
  return (m ? m[1] : t).trim();
}

/**
 * JSON 样例：`"测试用例通过率": "85%"`
 */
function extractTestResultFieldFromJson(text: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`"${escaped}"\\s*:\\s*(?:"([^"]*)"|(-?\\d+(?:\\.\\d+)?))`);
  const m = re.exec(text);
  if (!m) return null;
  const v = (m[1] ?? m[2] ?? "").trim();
  return v === "" ? null : v;
}

/**
 * Markdown 表格样例：`| 测试用例通过率 | \`85%\` |`
 */
function extractTestResultFieldFromMarkdownTable(text: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*(?:\`([^\`]*)\`|([^|\\n]+?))\\s*\\|`);
  const m = re.exec(text);
  if (!m) return null;
  const v = normalizeTestResultCellValue((m[1] ?? m[2] ?? "").trim());
  return v === "" ? null : v;
}

/** 依次尝试 JSON 键值对与 Markdown 表格行 */
export function extractTestResultField(text: string, key: string): string | null {
  return (
    extractTestResultFieldFromJson(text, key) ??
    extractTestResultFieldFromMarkdownTable(text, key)
  );
}

/** 预览「关联内容」展示的测试结果字段顺序 */
export const TEST_RESULT_DISPLAY_FIELDS = [
  "测试用例总数",
  "测试用例通过数",
  "测试用例失败数",
  "测试用例通过率",
  "是否代码问题",
  "是否测试环境问题",
  "是否因外部dubbo接口阻塞",
  "是否端到端测试",
  "测试总结简述",
] as const;

export type TestResultDisplayFieldKey = (typeof TEST_RESULT_DISPLAY_FIELDS)[number];

export type TestResultDisplayField = {
  key: TestResultDisplayFieldKey;
  value: string;
};

/**
 * 从正文提取「测试结果」关联内容表格行（复用 JSON / Markdown 表格字段解析）。
 * 无任一字段时返回 `null`；有字段时缺失项 `value` 为空串。
 */
export function parseTestResultDisplayFields(
  content: string,
): TestResultDisplayField[] | null {
  const text = sliceTestResultText(content);
  const rows: TestResultDisplayField[] = [];
  let any = false;
  for (const key of TEST_RESULT_DISPLAY_FIELDS) {
    const value = extractTestResultField(text, key);
    if (value != null) {
      any = true;
      rows.push({ key, value });
    } else {
      rows.push({ key, value: "" });
    }
  }
  return any ? rows : null;
}

/** 从文件正文正则提取通过率与总结；无有效通过率时返回 `null` */
function parseTestResultFromText(
  content: string,
): Omit<ParsedTaskOutPassRate, "sourceFile" | "reportContent"> | null {
  const text = sliceTestResultText(content);
  const passRateRaw = extractTestResultField(text, "测试用例通过率");
  if (!passRateRaw) return null;

  const passRate = parsePassRatePercent(passRateRaw);
  if (passRate == null) return null;

  const summaryRaw = extractTestResultField(text, "测试总结简述");
  const summary =
    summaryRaw != null && summaryRaw !== "" ? summaryRaw : undefined;

  const isCodeProblem = parseYesNoField(extractTestResultField(text, "是否代码问题")) ?? undefined;
  const isBlockedByExternalDubbo =
    parseYesNoField(extractTestResultField(text, "是否因外部dubbo接口阻塞")) ?? undefined;

  const base = {
    passRate,
    ...(summary !== undefined ? { summary } : {}),
    ...(isCodeProblem !== undefined ? { isCodeProblem } : {}),
    ...(isBlockedByExternalDubbo !== undefined ? { isBlockedByExternalDubbo } : {}),
  };
  return base;
}

/** 从单个任务仓库相对路径读取并解析通过率；失败返回 `null` */
export function parseTaskOutPassRateFromRepoFile(
  taskRepoCwd: string,
  relativePath: string,
): ParsedTaskOutPassRate | null {
  const filePath = join(taskRepoCwd, relativePath);
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const parsed = parseTestResultFromText(content);
  if (!parsed) return null;
  return { ...parsed, sourceFile: relativePath, reportContent: content };
}

/** 优先 `common_task_out` 前缀文件，否则按路径顺序取首个可解析结果 */
export function parseTaskOutPassRateFromChangedFiles(
  taskRepoCwd: string,
  relativePaths: string[],
): ParsedTaskOutPassRate | null {
  if (relativePaths.length === 0) return null;

  const sorted = [...relativePaths].sort((a, b) => {
    const aOut = a.includes("common_task_out") ? 0 : 1;
    const bOut = b.includes("common_task_out") ? 0 : 1;
    return aOut - bOut;
  });

  for (const rel of sorted) {
    const parsed = parseTaskOutPassRateFromRepoFile(taskRepoCwd, rel);
    if (parsed) return parsed;
  }
  return null;
}
