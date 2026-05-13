import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Agent 输出 `## 测试结果` 段内 JSON 的常用字段（与 out_tpl 约定一致） */
export type TaskOutTestResultJson = {
  测试用例总数?: number;
  测试用例通过数?: number;
  测试用例失败数?: number;
  测试用例通过率?: string;
  测试总结简述?: string;
  [key: string]: unknown;
};

/** 解析后的测试结果（通过率、总结简述）及来源文件 */
export type ParsedTaskOutPassRate = {
  passRate: number;
  /** `测试总结简述`；缺失时为 `undefined` */
  summary?: string;
  sourceFile: string;
};

const TEST_RESULT_HEADING = "## 测试结果";

/** 从百分比字符串（如 `85%`、`85.5%`）解析数值；无法解析时返回 `null` */
export function parsePassRatePercent(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (t === "") return null;
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*%?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseJsonObject(text: string): TaskOutTestResultJson | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return raw as TaskOutTestResultJson;
  } catch {
    return null;
  }
}

/** 从 Markdown 正文中提取 `## 测试结果` 后第一个 ```json` 代码块 */
export function extractTestResultJsonFromMarkdown(content: string): TaskOutTestResultJson | null {
  const idx = content.indexOf(TEST_RESULT_HEADING);
  if (idx < 0) return null;
  const after = content.slice(idx + TEST_RESULT_HEADING.length);
  const fence = /```json\s*\n([\s\S]*?)\n```/i.exec(after);
  if (!fence?.[1]) return null;
  return parseJsonObject(fence[1].trim());
}

/** 在 JSON 树中查找含 `测试用例通过率` 的对象（如 `common_task_out.json` 内嵌段） */
function findObjectWithPassRate(node: unknown): TaskOutTestResultJson | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return null;
  const obj = node as TaskOutTestResultJson;
  if (obj["测试用例通过率"] != null || obj.passRate != null) return obj;
  for (const value of Object.values(obj)) {
    const found = findObjectWithPassRate(value);
    if (found) return found;
  }
  return null;
}

/** 纯 JSON 文件（如 `common_task_out.json`） */
function parseStandaloneTestResultJson(content: string): TaskOutTestResultJson | null {
  const root = parseJsonObject(content.trim());
  if (!root) return null;
  return findObjectWithPassRate(root);
}

function pickPassRateString(obj: TaskOutTestResultJson): string | null {
  const v = obj["测试用例通过率"] ?? obj.passRate;
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function pickSummaryString(obj: TaskOutTestResultJson): string | undefined {
  const v = obj["测试总结简述"] ?? obj.summary;
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/** 将测试结果 JSON 转为通过率与总结；无有效通过率时返回 `null` */
export function buildParsedTaskOutPassRate(
  obj: TaskOutTestResultJson,
  sourceFile: string,
): ParsedTaskOutPassRate | null {
  const passRateRaw = pickPassRateString(obj);
  if (!passRateRaw) return null;

  const passRate = parsePassRatePercent(passRateRaw);
  if (passRate == null) return null;

  const summary = pickSummaryString(obj);
  return summary === undefined ? { passRate, sourceFile } : { passRate, summary, sourceFile };
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

  const lower = relativePath.toLowerCase();
  const obj = lower.endsWith(".json")
    ? parseStandaloneTestResultJson(content)
    : extractTestResultJsonFromMarkdown(content);

  if (!obj) return null;
  return buildParsedTaskOutPassRate(obj, relativePath);
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
