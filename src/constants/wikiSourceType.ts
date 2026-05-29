/**
 * 表 `wiki_source.source_type` 持久化字符串（Wiki 文档源类型）。
 */
export const WIKI_SOURCE_TYPE = {
  /** 基线文档 */
  BaselineDoc: "基线文档",
  /** 迭代文档 */
  IterationDoc: "迭代文档",
  /** spec 文档 */
  SpecDoc: "spec文档",
  /** 业务代码 Git 仓库地址（JSON：`{ gitRemoteUrl, branch_version }`） */
  CodeRepo: "代码地址",
  CodeRepo2: "代码地址2",
  CodeRepo3: "代码地址3",
  CodeRepo4: "代码地址4",
  CodeRepo5: "代码地址5",
} as const;

export type WikiSourceType = (typeof WIKI_SOURCE_TYPE)[keyof typeof WIKI_SOURCE_TYPE];

/** 智能问答 / 文档源配置支持的代码库槽位数 */
export const WIKI_CODE_REPO_SLOT_COUNT = 5;

export type WikiQaCodeRepoSlot = 1 | 2 | 3 | 4 | 5;

/** 槽位 1..5 对应的 `wiki_source.source_type` */
export const WIKI_CODE_REPO_SOURCE_TYPES = [
  WIKI_SOURCE_TYPE.CodeRepo,
  WIKI_SOURCE_TYPE.CodeRepo2,
  WIKI_SOURCE_TYPE.CodeRepo3,
  WIKI_SOURCE_TYPE.CodeRepo4,
  WIKI_SOURCE_TYPE.CodeRepo5,
] as const satisfies readonly WikiSourceType[];

const WIKI_SOURCE_TYPE_SET = new Set<string>(Object.values(WIKI_SOURCE_TYPE));

const CODE_REPO_SOURCE_TYPE_SET = new Set<string>(WIKI_CODE_REPO_SOURCE_TYPES);

/** 历史数值 → 中文字符串（迁移与兼容解析） */
const LEGACY_WIKI_SOURCE_TYPE_MAP: Record<number, WikiSourceType> = {
  1: WIKI_SOURCE_TYPE.BaselineDoc,
  2: WIKI_SOURCE_TYPE.IterationDoc,
  3: WIKI_SOURCE_TYPE.SpecDoc,
};

export function isWikiSourceType(value: unknown): value is WikiSourceType {
  return typeof value === "string" && WIKI_SOURCE_TYPE_SET.has(value);
}

export function parseWikiSourceTypeOptional(raw: unknown): WikiSourceType | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return null;
    if (isWikiSourceType(t)) return t;
    const n = Number(t);
    if (Number.isInteger(n) && LEGACY_WIKI_SOURCE_TYPE_MAP[n]) {
      return LEGACY_WIKI_SOURCE_TYPE_MAP[n];
    }
  }
  if (typeof raw === "number" && Number.isInteger(raw) && LEGACY_WIKI_SOURCE_TYPE_MAP[raw]) {
    return LEGACY_WIKI_SOURCE_TYPE_MAP[raw];
  }
  return null;
}

/** 展示用标签（与持久化值一致；兼容历史数值） */
export function wikiSourceTypeLabel(code: WikiSourceType | number | string): string {
  return parseWikiSourceTypeOptional(code) ?? String(code);
}

/** 是否为代码仓库类文档源（不参与 Confluence 同步） */
export function isCodeRepoWikiSourceType(type: WikiSourceType): boolean {
  return CODE_REPO_SOURCE_TYPE_SET.has(type);
}

export function isWikiQaCodeRepoSlot(value: unknown): value is WikiQaCodeRepoSlot {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= WIKI_CODE_REPO_SLOT_COUNT
  );
}

export function wikiCodeRepoSourceTypeForSlot(slot: WikiQaCodeRepoSlot): WikiSourceType {
  return WIKI_CODE_REPO_SOURCE_TYPES[slot - 1];
}

/** 文档源配置 / 未配置提示用标签 */
export function wikiCodeRepoConfigLabel(slot: WikiQaCodeRepoSlot): string {
  return slot === 1 ? "代码地址" : `代码地址${slot}`;
}
