import { writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { TPL_KEY } from "../../constants/tplKey.js";
import { listPromptTplByTaskTypeAndUser } from "../../db/prompt/listPromptTplByTaskTypeAndUser.js";
import type { TaskRow } from "../../db/workflow.js";
import { firstPromptTplContent } from "../prompt/buildClaimedTaskPrompt.js";

/**
 * 步骤 7.3：查询 `tpl_key=2`（out_tpl）；若有模板则原样写入 `task_out_tpl.txt`。
 */
export function writeClaimedTaskOutTplFile(
  db: DatabaseSync,
  task: TaskRow,
  taskRepoCwd: string,
): void {
  const username = task.creator?.trim() ?? "";
  if (!username) return;

  const templates = listPromptTplByTaskTypeAndUser(db, task.task_type, username, {
    tplKey: TPL_KEY.OutTpl,
  });
  const outTplPrompt = firstPromptTplContent(templates);
  if (!outTplPrompt) return;

  const filePath = path.join(taskRepoCwd, "task_out_tpl.txt");
  writeFileSync(filePath, outTplPrompt, "utf8");
}
