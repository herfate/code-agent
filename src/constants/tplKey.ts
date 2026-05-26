/**
 * 表 `prompt_tpl.tpl_key` 持久化数值。
 * 1 init 提示词、2 out_tpl、3 follow_up（追加对话）。
 */
export const TPL_KEY = {
  Init: 1,
  OutTpl: 2,
  FollowUp: 3,
} as const;

export type TplKey = (typeof TPL_KEY)[keyof typeof TPL_KEY];

const TPL_KEY_SET = new Set<number>(Object.values(TPL_KEY) as TplKey[]);

export function isTplKey(n: unknown): n is TplKey {
  return typeof n === "number" && Number.isInteger(n) && TPL_KEY_SET.has(n);
}

/** 写入/查询 `prompt_tpl.tpl_key`（TEXT 列存数字字符串） */
export function tplKeyDbValue(key: TplKey): string {
  return String(key);
}

export function parseTplKey(raw: unknown): TplKey | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && isTplKey(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return null;
    const n = Number(t);
    if (isTplKey(n)) return n;
  }
  return null;
}

export function tplKeyLabel(code: TplKey | number | string): string {
  const n = typeof code === "number" ? code : Number(String(code).trim());
  switch (n) {
    case TPL_KEY.Init:
      return "init提示词";
    case TPL_KEY.OutTpl:
      return "out_tpl";
    case TPL_KEY.FollowUp:
      return "follow_up";
    default:
      return String(code);
  }
}
