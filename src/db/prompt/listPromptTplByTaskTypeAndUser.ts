import type { DatabaseSync } from "node:sqlite";
import type { TaskType } from "../../constants/taskType.js";
import { tplKeyDbValue, type TplKey } from "../../constants/tplKey.js";
import { rowFromGet, type PromptTplRow } from "../promptTpl.js";

const PROMPT_TPL_COLUMNS = `id, created_at, updated_at, order_index, prompt, task_type, tpl_key, username`;

/** 按任务类型、用户名（含通配 `*`）与可选 `tpl_key` 查询；具体用户优先于 `*` */
function sqlListByTaskTypeAndUser(withTplKey: boolean): string {
  const tplFilter = withTplKey ? " AND tpl_key = ?" : "";
  return `
  SELECT ${PROMPT_TPL_COLUMNS}
  FROM prompt_tpl
  WHERE task_type = ? AND username IN (?, '*')${tplFilter}
  ORDER BY CASE WHEN username = '*' THEN 1 ELSE 0 END, COALESCE(order_index, 0), id ASC
  LIMIT ?
`;
}

export function listPromptTplByTaskTypeAndUser(
  db: DatabaseSync,
  taskType: TaskType,
  username: string,
  options?: { limit?: number; tplKey?: TplKey },
): PromptTplRow[] {
  const user = username.trim();
  if (!user) return [];

  const limit = options?.limit ?? 50;
  const n = Math.min(500, Math.max(1, limit));
  const tplKey = options?.tplKey;

  const sql = sqlListByTaskTypeAndUser(tplKey !== undefined);
  const stmt = db.prepare(sql);
  const rows =
    tplKey !== undefined
      ? (stmt.all(taskType, user, tplKeyDbValue(tplKey), n) as unknown[])
      : (stmt.all(taskType, user, n) as unknown[]);
  return rows.map((r) => rowFromGet(r)!).filter(Boolean);
}
