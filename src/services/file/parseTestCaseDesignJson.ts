/** 功能测试用例设计 JSON（`test_case_design.json`）列定义 */
export type TestCaseDesignColumn = {
  key: string;
  header: string;
  width?: number;
};

/** 单条用例（字段随 columns 扩展） */
export type TestCaseDesignCase = Record<string, unknown>;

export type TestCaseDesignDoc = {
  version?: string;
  meta?: Record<string, unknown>;
  columns: TestCaseDesignColumn[];
  cases: TestCaseDesignCase[];
  open_questions?: unknown;
};

/** 默认 Excel 列（与 functest-case-gen-out-tpl 一致） */
export const DEFAULT_TEST_CASE_DESIGN_COLUMNS: TestCaseDesignColumn[] = [
  { key: "module", header: "功能模块", width: 15 },
  { key: "sub_module", header: "子模块", width: 15 },
  { key: "feature", header: "功能点", width: 20 },
  { key: "test_scenario", header: "测试场景", width: 40 },
  { key: "case_type_label", header: "正反例", width: 10 },
  { key: "steps_text", header: "操作步骤", width: 50 },
  { key: "expected_results_text", header: "预期结果", width: 50 },
  { key: "data_sql_text", header: "数据表", width: 40 },
  { key: "review_status", header: "评审加用例", width: 12 },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function looksLikeTestCase(row: unknown): boolean {
  if (!isRecord(row)) return false;
  return (
    row.test_scenario != null ||
    row.module != null ||
    row.case_id != null ||
    row.steps_text != null ||
    row.steps != null
  );
}

/** 是否为可导出 Excel 的功能测试用例 JSON */
export function isTestCaseDesignJson(value: unknown): value is TestCaseDesignDoc {
  if (!isRecord(value) || !Array.isArray(value.cases)) return false;
  if (Array.isArray(value.columns)) return true;
  if (value.cases.length === 0) return false;
  return value.cases.some(looksLikeTestCase);
}

/** 解析并规范化用例设计文档；无法识别时返回 `null` */
export function parseTestCaseDesignContent(content: string): TestCaseDesignDoc | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (!isTestCaseDesignJson(parsed)) return null;

  const columns =
    Array.isArray(parsed.columns) && parsed.columns.length > 0
      ? parsed.columns.filter(
          (c): c is TestCaseDesignColumn =>
            isRecord(c) && typeof c.key === "string" && typeof c.header === "string",
        )
      : DEFAULT_TEST_CASE_DESIGN_COLUMNS;

  return {
    ...parsed,
    columns,
    cases: parsed.cases.filter((c) => isRecord(c)),
  };
}

/** 由源 JSON 文件名推导 Excel 文件名 */
export function testCaseDesignExcelFilename(sourceFilename?: string): string {
  const base = sourceFilename?.split(/[/\\]/).pop()?.trim();
  if (base && /\.json$/i.test(base)) return base.replace(/\.json$/i, ".xlsx");
  return "test_case_design.xlsx";
}
