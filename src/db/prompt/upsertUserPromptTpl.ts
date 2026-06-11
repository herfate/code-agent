import type { DatabaseSync } from "node:sqlite";
import type { TaskType } from "../../constants/taskType.js";
import { tplKeyDbValue, type TplKey } from "../../constants/tplKey.js";
import {
  createPromptTpl,
  deletePromptTpl,
  rowFromGet,
  updatePromptTpl,
  type PromptTplRow,
} from "../promptTpl.js";

export type UpsertUserPromptTplInput = {
  username: string;
  task_type: TaskType;
  tpl_key: TplKey;
  prompt: string;
};

export type UpsertUserPromptTplResult = {
  action: "saved" | "deleted" | "noop";
  row?: PromptTplRow;
};

const PROMPT_TPL_COLUMNS = `id, created_at, updated_at, order_index, prompt, task_type, tpl_key, username`;

function findUserRow(
  db: DatabaseSync,
  username: string,
  taskType: TaskType,
  tplKey: TplKey,
): PromptTplRow | undefined {
  const r = db
    .prepare(
      `SELECT ${PROMPT_TPL_COLUMNS} FROM prompt_tpl
       WHERE username = ? AND task_type = ? AND tpl_key = ? LIMIT 1`,
    )
    .get(username, taskType, tplKeyDbValue(tplKey));
  return rowFromGet(r);
}

/** 保存非空 → upsert 用户行；保存空白 → 删除用户行回退全局 */
export function upsertUserPromptTpl(
  db: DatabaseSync,
  input: UpsertUserPromptTplInput,
): UpsertUserPromptTplResult {
  const user = input.username.trim();
  if (!user || user === "*") {
    throw new Error("username 不能为空或通配 '*'");
  }
  const content = input.prompt ?? "";
  const existing = findUserRow(db, user, input.task_type, input.tpl_key);
  if (!content.trim()) {
    if (existing) {
      deletePromptTpl(db, existing.id);
      return { action: "deleted" };
    }
    return { action: "noop" };
  }
  if (existing) {
    const updated = updatePromptTpl(db, existing.id, { prompt: content });
    return { action: "saved", row: updated };
  }
  const row = createPromptTpl(db, {
    prompt: content,
    task_type: input.task_type,
    tpl_key: tplKeyDbValue(input.tpl_key),
    username: user,
  });
  return { action: "saved", row };
}

/** 显式删除用户行（前端「重置」按钮调用） */
export function deleteUserPromptTpl(
  db: DatabaseSync,
  username: string,
  taskType: TaskType,
  tplKey: TplKey,
): boolean {
  const user = username.trim();
  if (!user || user === "*") return false;
  const existing = findUserRow(db, user, taskType, tplKey);
  if (!existing) return false;
  return deletePromptTpl(db, existing.id);
}