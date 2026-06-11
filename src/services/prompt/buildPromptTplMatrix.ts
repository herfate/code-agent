import type { DatabaseSync } from "node:sqlite";
import { TASK_TYPE, taskTypeLabel, TOOL_TASK_TYPES, type TaskType } from "../../constants/taskType.js";
import { TPL_KEY, tplKeyLabel, type TplKey } from "../../constants/tplKey.js";
import type { PromptTplRow } from "../../db/promptTpl.js";
import { listPromptTplMatrixForUser } from "../../db/prompt/listPromptTplMatrixForUser.js";

export type PromptTplMatrixCell = {
  task_type: TaskType;
  tpl_key: TplKey;
  task_type_label: string;
  tpl_key_label: string;
  global_prompt: string | null;
  global_row_id: number | null;
  user_prompt: string | null;
  user_row_id: number | null;
  resolved_prompt: string | null;
  source: "user" | "global" | "none";
  updated_at: number | null;
};

/** 构造完整 task_type × tpl_key 矩阵；剔除工具任务（101-103） */
export function buildPromptTplMatrix(db: DatabaseSync, username: string): PromptTplMatrixCell[] {
  const rows = listPromptTplMatrixForUser(db, username);
  const byKey = new Map<string, { global?: PromptTplRow; user?: PromptTplRow }>();
  for (const r of rows) {
    const key = `${r.task_type ?? ""}|${r.tpl_key ?? ""}`;
    const bucket = byKey.get(key) ?? {};
    if (r.username === "*") bucket.global = r;
    else bucket.user = r;
    byKey.set(key, bucket);
  }

  const cells: PromptTplMatrixCell[] = [];
  const taskTypes = Object.values(TASK_TYPE).filter(
    (t): t is TaskType => typeof t === "number" && !TOOL_TASK_TYPES.includes(t as TaskType),
  );
  const tplKeys = Object.values(TPL_KEY).filter((t): t is TplKey => typeof t === "number");

  for (const tt of taskTypes) {
    for (const tk of tplKeys) {
      const key = `${tt}|${tk}`;
      const bucket = byKey.get(key);
      const globalRow = bucket?.global;
      const userRow = bucket?.user;
      const globalPrompt = globalRow?.prompt?.trim() ?? null;
      const userPrompt = userRow?.prompt?.trim() ?? null;
      const resolved = userPrompt ?? globalPrompt;
      const source: "user" | "global" | "none" = userRow
        ? "user"
        : globalRow
          ? "global"
          : "none";
      const updatedAt = userRow?.updated_at ?? globalRow?.updated_at ?? null;
      cells.push({
        task_type: tt,
        tpl_key: tk,
        task_type_label: taskTypeLabel(tt),
        tpl_key_label: tplKeyLabel(tk),
        global_prompt: globalPrompt,
        global_row_id: globalRow?.id ?? null,
        user_prompt: userPrompt,
        user_row_id: userRow?.id ?? null,
        resolved_prompt: resolved,
        source,
        updated_at: updatedAt,
      });
    }
  }
  return cells;
}