/** `design.md`「澄清摘要」下 JSON 中的可点选选项 */
export type ClarificationOption = {
  id: string;
  label: string;
  recommended?: boolean;
};

/** 澄清表单单题 */
export type ClarificationQuestion = {
  id: string;
  severity: "blocking" | "non_blocking";
  title: string;
  description?: string;
  input_type: "single" | "multi" | "text";
  required?: boolean;
  allow_custom?: boolean;
  options?: ClarificationOption[];
};

/** 澄清表单（`clarification_form`） */
export type ClarificationForm = {
  version: number;
  questions: ClarificationQuestion[];
};

/** `## 澄清摘要` 下首个 ```json 块解析结果 */
export type DesignClarificationSummary = {
  ready_for_dev: boolean;
  blocking_questions_count: number;
  non_blocking_questions_count: number;
  requirement_items_count?: number;
  acceptance_criteria_count?: number;
  dev_task_count?: number;
  summary_zh: string;
  clarification_form: ClarificationForm;
};

const CLARIFICATION_SUMMARY_HEADING = /^##\s+澄清摘要\s*$/m;
const JSON_FENCE = /```json\s*\r?\n([\s\S]*?)\r?\n```/;

/** 从 design.md 中提取「澄清摘要」下第一个 ```json  fenced 块正文 */
export function extractClarificationSummaryJsonBlock(markdown: string): string | null {
  const headingMatch = markdown.match(CLARIFICATION_SUMMARY_HEADING);
  if (!headingMatch || headingMatch.index === undefined) return null;
  const afterHeading = markdown.slice(headingMatch.index + headingMatch[0].length);
  const fenceMatch = afterHeading.match(JSON_FENCE);
  return fenceMatch ? fenceMatch[1]!.trim() : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeOption(raw: unknown): ClarificationOption | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!id || !label) return null;
  return raw.recommended === true ? { id, label, recommended: true } : { id, label };
}

function normalizeQuestion(raw: unknown): ClarificationQuestion | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const severity = raw.severity;
  const inputType = raw.input_type;
  if (!id || !title) return null;
  if (severity !== "blocking" && severity !== "non_blocking") return null;
  if (inputType !== "single" && inputType !== "multi" && inputType !== "text") return null;

  const question: ClarificationQuestion = {
    id,
    severity,
    title,
    input_type: inputType,
  };
  if (typeof raw.description === "string" && raw.description.trim()) {
    question.description = raw.description.trim();
  }
  if (raw.required === true) question.required = true;
  if (raw.allow_custom === true) question.allow_custom = true;
  if (Array.isArray(raw.options)) {
    const options = raw.options
      .map(normalizeOption)
      .filter((o): o is ClarificationOption => o !== null);
    if (options.length > 0) question.options = options;
  }
  return question;
}

function normalizeClarificationForm(raw: unknown): ClarificationForm | null {
  if (!isRecord(raw)) return null;
  const version = typeof raw.version === "number" ? raw.version : Number(raw.version);
  if (!Number.isFinite(version)) return null;
  if (!Array.isArray(raw.questions)) return null;
  const questions = raw.questions
    .map(normalizeQuestion)
    .filter((q): q is ClarificationQuestion => q !== null);
  return { version, questions };
}

/** 解析 design.md 澄清摘要 JSON；格式不符或缺字段时返回 `null` */
export function parseDesignClarificationSummary(content: string): DesignClarificationSummary | null {
  const jsonText = extractClarificationSummaryJsonBlock(content);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const readyForDev = parsed.ready_for_dev;
  if (typeof readyForDev !== "boolean") return null;

  const blockingCount = Number(parsed.blocking_questions_count);
  const nonBlockingCount = Number(parsed.non_blocking_questions_count);
  if (!Number.isFinite(blockingCount) || !Number.isFinite(nonBlockingCount)) return null;

  const summaryZh = typeof parsed.summary_zh === "string" ? parsed.summary_zh.trim() : "";
  if (!summaryZh) return null;

  const form = normalizeClarificationForm(parsed.clarification_form);
  if (!form) return null;

  const result: DesignClarificationSummary = {
    ready_for_dev: readyForDev,
    blocking_questions_count: blockingCount,
    non_blocking_questions_count: nonBlockingCount,
    summary_zh: summaryZh,
    clarification_form: form,
  };

  const reqCount = Number(parsed.requirement_items_count);
  if (Number.isFinite(reqCount)) result.requirement_items_count = reqCount;
  const acCount = Number(parsed.acceptance_criteria_count);
  if (Number.isFinite(acCount)) result.acceptance_criteria_count = acCount;
  const devCount = Number(parsed.dev_task_count);
  if (Number.isFinite(devCount)) result.dev_task_count = devCount;

  return result;
}
