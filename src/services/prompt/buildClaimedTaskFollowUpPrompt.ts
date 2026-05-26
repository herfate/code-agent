import type { DatabaseSync } from "node:sqlite";
import { TPL_KEY } from "../../constants/tplKey.js";
import { listPromptTplByTaskTypeAndUser } from "../../db/prompt/listPromptTplByTaskTypeAndUser.js";
import type { TaskRow } from "../../db/workflow.js";
import { firstPromptTplContent } from "./buildClaimedTaskPrompt.js";
import { applyInputJsonPlaceholders } from "./replaceInputJsonPlaceholders.js";

/**
 * 步骤 11.5：查询 `tpl_key=3`（follow_up）；无模板则空。
 */
export function buildClaimedTaskFollowUpPrompt(db: DatabaseSync, task: TaskRow): string {
  const username = task.creator?.trim() ?? "";
  if (username) {
    const templates = listPromptTplByTaskTypeAndUser(db, task.task_type, username, {
      tplKey: TPL_KEY.FollowUp,
    });
    const fromDb = firstPromptTplContent(templates);
    if (fromDb) return applyInputJsonPlaceholders(fromDb, task.input_json);
  }
  return '';
}
