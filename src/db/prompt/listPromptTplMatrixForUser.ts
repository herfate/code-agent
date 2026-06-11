import type { DatabaseSync } from "node:sqlite";
import { rowFromGet, type PromptTplRow } from "../promptTpl.js";

const PROMPT_TPL_COLUMNS = `id, created_at, updated_at, order_index, prompt, task_type, tpl_key, username`;

/** 一次性查某用户的所有 prompt_tpl 行（含全局 `*`）；按 (task_type, tpl_key) 分组后具体用户行优先于 `*` */
export function listPromptTplMatrixForUser(
  db: DatabaseSync,
  username: string,
  limit = 500,
): PromptTplRow[] {
  const user = username.trim();
  if (!user) return [];
  const n = Math.min(500, Math.max(1, limit));
  const sql = `
    SELECT ${PROMPT_TPL_COLUMNS}
    FROM prompt_tpl
    WHERE username IN (?, '*')
    ORDER BY COALESCE(task_type, -1) ASC,
             COALESCE(tpl_key, '') ASC,
             CASE WHEN username = '*' THEN 1 ELSE 0 END,
             id ASC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(user, n) as unknown[];
  return rows.map((r) => rowFromGet(r)!).filter(Boolean);
}