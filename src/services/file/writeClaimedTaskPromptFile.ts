import { writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { TPL_KEY } from "../../constants/tplKey.js";
import { listPromptTplByTaskTypeAndUser } from "../../db/prompt/listPromptTplByTaskTypeAndUser.js";
import {TASK_TYPE, TaskRow} from "../../db/workflow.js";
import { firstPromptTplContent } from "../prompt/buildClaimedTaskPrompt.js";
import { applyInputJsonPlaceholders } from "../prompt/replaceInputJsonPlaceholders.js";

/**
 * 步骤 7.2：查询 `tpl_key=1`（init），`task_prompt.md` 写入 `description`；
 * 返回优先匹配的首条模板 `prompt` 作为 Agent 提示词（无模板时回退 `description`）。
 */
export function writeClaimedTaskPromptFile(
  db: DatabaseSync,
  task: TaskRow,
  taskRepoCwd: string,
): string {
  const description = task.description.trim();

  if (description) {
    let promptFileName = "task_prompt.md";
    if (task.task_type === TASK_TYPE.TestDataAnalysis || task.task_type === TASK_TYPE.TestCaseExecute) {
      promptFileName = "common_task_out.json";
    }
    const filePath = path.join(taskRepoCwd, promptFileName);
    writeFileSync(filePath, description, "utf8");
  }

  const username = task.creator?.trim() ?? "";
  if (!username) return description;

  const templates = listPromptTplByTaskTypeAndUser(db, task.task_type, username, {
    tplKey: TPL_KEY.Init,
  });
  const promptContent = firstPromptTplContent(templates);
  if (!promptContent) return description;
  return applyInputJsonPlaceholders(promptContent, task.input_json);
}
