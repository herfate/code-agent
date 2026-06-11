/** 自动化测试案例 JSON（QA 平台导出格式）单条用例 */
export type AutotestCaseItem = {
  title: string;
  describe: string | null;
  input: string;
  expect: string;
  delivers: string | null;
  order: number | null;
  scriptId: number | null;
  parallelStatus: boolean | null;
  labelNames: string[];
  id: number | null;
  caseAssertCount: string | null;
  caseDataOperationCount: string | null;
  caseMockCode: string | null;
};

/** 单个符合规范的自动化测试案例 JSON 文件 */
export type AutotestCaseFileDoc = {
  relative_path: string;
  cases: AutotestCaseItem[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  return Boolean(v);
}

function labelNamesFrom(raw: Record<string, unknown>, vo: Record<string, unknown>): string[] {
  const names = raw.labelNames ?? vo.labelNames;
  if (Array.isArray(names)) {
    return names.filter((x): x is string => typeof x === "string");
  }
  const vos = raw.labelVos ?? vo.labelVos;
  if (Array.isArray(vos)) {
    return vos
      .filter(isRecord)
      .map((x) => x.labelName)
      .filter((x): x is string => typeof x === "string");
  }
  return [];
}

/** 从 `data.list[]` 元素提取用例字段 */
function extractCaseItem(raw: unknown): AutotestCaseItem | null {
  if (!isRecord(raw)) return null;
  const vo = isRecord(raw.scriptCaseVo) ? raw.scriptCaseVo : raw;
  const title = vo.title ?? raw.title;
  const input = vo.input ?? raw.input;
  const expect = vo.expect ?? raw.expect;
  if (typeof title !== "string" || typeof input !== "string" || typeof expect !== "string") {
    return null;
  }
  return {
    title,
    describe: strOrNull(vo.describe ?? raw.describe),
    input,
    expect,
    delivers: strOrNull(vo.delivers ?? raw.delivers),
    order: numOrNull(vo.order ?? raw.order),
    scriptId: numOrNull(vo.scriptId ?? raw.scriptId),
    parallelStatus: boolOrNull(vo.parallelStatus ?? raw.parallelStatus),
    labelNames: labelNamesFrom(raw, vo),
    id: numOrNull(vo.id ?? raw.id),
    caseAssertCount: strOrNull(vo.caseAssertCount ?? raw.caseAssertCount),
    caseDataOperationCount: strOrNull(vo.caseDataOperationCount ?? raw.caseDataOperationCount),
    caseMockCode: strOrNull(vo.caseMockCode ?? raw.caseMockCode),
  };
}

/** 是否为 QA 自动化测试案例 JSON（含 `data.list[].scriptCaseVo` 或同结构扁平字段） */
export function isAutotestCaseJson(value: unknown): value is { data: { list: unknown[] } } {
  if (!isRecord(value)) return false;
  // 排除 script.json（接口元数据）
  if (value.apiProtocol != null || value.apiPath != null) return false;
  // 排除功能测试用例设计 JSON
  if (Array.isArray(value.cases)) return false;
  const data = value.data;
  if (!isRecord(data) || !Array.isArray(data.list) || data.list.length === 0) return false;
  return data.list.some((item) => extractCaseItem(item) !== null);
}

/** 解析自动化测试案例 JSON 内容；无法识别时返回 `null` */
export function parseAutotestCaseContent(
  content: string,
  relativePath: string,
): AutotestCaseFileDoc | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (!isAutotestCaseJson(parsed)) return null;

  const cases = parsed.data.list
    .map((item) => extractCaseItem(item))
    .filter((c): c is AutotestCaseItem => c !== null);
  if (cases.length === 0) return null;

  return { relative_path: relativePath, cases };
}

/** 多文件合并导出时的默认 Excel 文件名 */
export function autotestCaseExcelFilename(pid?: string): string {
  const suffix = pid?.trim() ? `_${pid.trim()}` : "";
  return `autotest_cases${suffix}.xlsx`;
}
