import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Code Review 报告约定文件名（Agent 优先输出） */
export const CODE_REVIEW_REPORT_BASENAME = "code-review-report.md";

/** Agent 输出 `## 审查摘要` 段内 JSON 字段（与 out_tpl / 示例报告一致） */
export const CODE_REVIEW_SUMMARY_HEADING = "## 审查摘要";

/** 审查结论枚举 */
export const CODE_REVIEW_VERDICT = {
  Approve: "approve",
  PassWithComments: "pass_with_comments",
  RequestChanges: "request_changes",
  NeedsHumanReview: "needs_human_review",
} as const;

export type CodeReviewVerdict = (typeof CODE_REVIEW_VERDICT)[keyof typeof CODE_REVIEW_VERDICT];

const CODE_REVIEW_VERDICT_SET = new Set<string>(Object.values(CODE_REVIEW_VERDICT));

export type CodeReviewSeverityCounts = {
  blocker: number;
  major: number;
  minor: number;
  nit: number;
  info: number;
};

/** Markdown / JSON 中的审查摘要对象 */
export type TaskOutCodeReviewSummaryJson = {
  verdict?: string;
  verdict_label?: string;
  merge_recommendation?: boolean;
  /** 显式覆盖合并门禁（优先于 merge_recommendation） */
  merge_allowed?: boolean;
  confidence?: string;
  scope_coverage_percent?: number;
  counts?: Partial<CodeReviewSeverityCounts>;
  business_risk_level?: string;
  code_quality_score?: number;
  must_fix_before_merge?: string[];
  summary_zh?: string;
  reviewed_files_count?: number;
  out_of_scope_not_reviewed?: string[];
  [key: string]: unknown;
};

/** 解析后的门禁结果（落库与流水线判断） */
export type ParsedCodeReviewGate = {
  mergeAllowed: boolean;
  verdict: CodeReviewVerdict;
  verdictLabel: string;
  counts: CodeReviewSeverityCounts;
  mustFixBeforeMerge: string[];
  summaryZh: string;
  sourceFile: string;
  /** 写入 `CodeReviewGateResult` 的完整对象 */
  gateResult: {
    merge_allowed: boolean;
    verdict: CodeReviewVerdict;
    verdict_label: string;
    merge_recommendation: boolean;
    counts: CodeReviewSeverityCounts;
    must_fix_before_merge: string[];
    summary_zh: string;
    business_risk_level?: string;
    code_quality_score?: number;
    confidence?: string;
  };
};

function parseJsonObject(text: string): TaskOutCodeReviewSummaryJson | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return raw as TaskOutCodeReviewSummaryJson;
  } catch {
    return null;
  }
}

function normalizeVerdict(raw: string | undefined): CodeReviewVerdict | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (CODE_REVIEW_VERDICT_SET.has(t)) return t as CodeReviewVerdict;
  return null;
}

function normalizeCounts(
  partial: Partial<CodeReviewSeverityCounts> | undefined,
): CodeReviewSeverityCounts {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0;
  };
  return {
    blocker: n(partial?.blocker),
    major: n(partial?.major),
    minor: n(partial?.minor),
    nit: n(partial?.nit),
    info: n(partial?.info),
  };
}

function normalizeMustFix(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim())
    .filter((s) => s.length > 0);
}

/**
 * 计算是否允许合并。
 * 规则：blocker>0 一律 false；否则优先 `merge_allowed`，其次 `merge_recommendation`，再按 verdict 保守推断。
 */
export function computeCodeReviewMergeAllowed(obj: TaskOutCodeReviewSummaryJson): boolean {
  const counts = normalizeCounts(obj.counts);
  if (counts.blocker > 0) return false;

  if (typeof obj.merge_allowed === "boolean") return obj.merge_allowed;
  if (typeof obj.merge_recommendation === "boolean") return obj.merge_recommendation;

  const verdict = normalizeVerdict(obj.verdict);
  if (verdict === CODE_REVIEW_VERDICT.Approve) return true;
  if (
    verdict === CODE_REVIEW_VERDICT.RequestChanges ||
    verdict === CODE_REVIEW_VERDICT.NeedsHumanReview
  ) {
    return false;
  }
  // pass_with_comments 且无显式字段：有 major 则保守为 false
  if (verdict === CODE_REVIEW_VERDICT.PassWithComments) {
    return counts.major === 0;
  }
  return false;
}

const VERDICT_LABEL_ZH: Record<CodeReviewVerdict, string> = {
  [CODE_REVIEW_VERDICT.Approve]: "通过",
  [CODE_REVIEW_VERDICT.PassWithComments]: "有条件通过",
  [CODE_REVIEW_VERDICT.RequestChanges]: "需修改",
  [CODE_REVIEW_VERDICT.NeedsHumanReview]: "需人工复核",
};

/** 从 Markdown 正文提取 `## 审查摘要` 后第一个 ```json` 代码块 */
export function extractCodeReviewSummaryJsonFromMarkdown(
  content: string,
): TaskOutCodeReviewSummaryJson | null {
  const idx = content.indexOf(CODE_REVIEW_SUMMARY_HEADING);
  if (idx < 0) return null;
  const after = content.slice(idx + CODE_REVIEW_SUMMARY_HEADING.length);
  const fence = /```json\s*\n([\s\S]*?)\n```/i.exec(after);
  if (!fence?.[1]) return null;
  return parseJsonObject(fence[1].trim());
}

/** 在 JSON 树中查找含 `verdict` 或 `merge_recommendation` 的审查摘要对象 */
function findObjectWithCodeReviewSummary(node: unknown): TaskOutCodeReviewSummaryJson | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return null;
  const obj = node as TaskOutCodeReviewSummaryJson;
  if (obj.verdict != null || obj.merge_recommendation != null || obj.merge_allowed != null) {
    return obj;
  }
  for (const value of Object.values(obj)) {
    const found = findObjectWithCodeReviewSummary(value);
    if (found) return found;
  }
  return null;
}

function parseStandaloneCodeReviewJson(content: string): TaskOutCodeReviewSummaryJson | null {
  const root = parseJsonObject(content.trim());
  if (!root) return null;
  return findObjectWithCodeReviewSummary(root);
}

/** 将审查摘要 JSON 转为门禁结构；缺少 verdict 时返回 `null` */
export function buildParsedCodeReviewGate(
  obj: TaskOutCodeReviewSummaryJson,
  sourceFile: string,
): ParsedCodeReviewGate | null {
  const verdict = normalizeVerdict(obj.verdict);
  if (!verdict) return null;

  const counts = normalizeCounts(obj.counts);
  const mustFixBeforeMerge = normalizeMustFix(obj.must_fix_before_merge);
  const mergeAllowed = computeCodeReviewMergeAllowed(obj);
  const verdictLabel =
    (obj.verdict_label != null && String(obj.verdict_label).trim() !== ""
      ? String(obj.verdict_label).trim()
      : VERDICT_LABEL_ZH[verdict]) ?? verdict;
  const summaryZh =
    obj.summary_zh != null && String(obj.summary_zh).trim() !== ""
      ? String(obj.summary_zh).trim()
      : "";

  const mergeRecommendation =
    typeof obj.merge_recommendation === "boolean"
      ? obj.merge_recommendation
      : mergeAllowed;

  return {
    mergeAllowed,
    verdict,
    verdictLabel,
    counts,
    mustFixBeforeMerge,
    summaryZh,
    sourceFile,
    gateResult: {
      merge_allowed: mergeAllowed,
      verdict,
      verdict_label: verdictLabel,
      merge_recommendation: mergeRecommendation,
      counts,
      must_fix_before_merge: mustFixBeforeMerge,
      summary_zh: summaryZh,
      ...(obj.business_risk_level != null
        ? { business_risk_level: String(obj.business_risk_level) }
        : {}),
      ...(typeof obj.code_quality_score === "number" && Number.isFinite(obj.code_quality_score)
        ? { code_quality_score: obj.code_quality_score }
        : {}),
      ...(obj.confidence != null ? { confidence: String(obj.confidence) } : {}),
    },
  };
}

/** 从单个任务仓库相对路径读取并解析 Code Review 门禁；失败返回 `null` */
export function parseCodeReviewGateFromRepoFile(
  taskRepoCwd: string,
  relativePath: string,
): ParsedCodeReviewGate | null {
  const filePath = join(taskRepoCwd, relativePath);
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const lower = relativePath.toLowerCase();
  const obj = lower.endsWith(".json")
    ? parseStandaloneCodeReviewJson(content)
    : extractCodeReviewSummaryJsonFromMarkdown(content);

  if (!obj) return null;
  return buildParsedCodeReviewGate(obj, relativePath);
}

function scoreChangedFilePath(p: string): number {
  const lower = p.toLowerCase();
  if (lower.includes(CODE_REVIEW_REPORT_BASENAME.replace(".md", ""))) return 0;
  if (lower.endsWith("code-review-report.md")) return 0;
  if (lower.includes("common_task_out")) return 1;
  return 2;
}

/** 优先 `code-review-report.md`，否则 `common_task_out`，再按路径顺序 */
export function parseCodeReviewGateFromChangedFiles(
  taskRepoCwd: string,
  relativePaths: string[],
): ParsedCodeReviewGate | null {
  if (relativePaths.length === 0) return null;

  const sorted = [...relativePaths].sort(
    (a, b) => scoreChangedFilePath(a) - scoreChangedFilePath(b),
  );

  for (const rel of sorted) {
    const parsed = parseCodeReviewGateFromRepoFile(taskRepoCwd, rel);
    if (parsed) return parsed;
  }
  return null;
}
