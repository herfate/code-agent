import { randomUUID } from "node:crypto";
import {
  CODE_REVIEW_GATE_PARAM_KEY,
  codeReviewGateParamKeyLabel,
  codeReviewGateParamKeysForTaskType,
} from "../../../constants/codeReviewGateParamKey.js";
import type { TaskType } from "../../../constants/taskType.js";
import { upsertParentTaskParam } from "../../../db/workflow.js";
import { parseCodeReviewGateFromChangedFiles } from "../../file/parseTaskOutCodeReviewResult.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** Code Review 任务：从报告 Markdown 提取审查摘要，落库合并门禁与完整结果 */
export const persistCodeReviewGateParamHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return codeReviewGateParamKeysForTaskType(taskType).length > 0;
  },

  handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const paramKeys = codeReviewGateParamKeysForTaskType(ctx.taskType);
    if (paramKeys.length === 0) return Promise.resolve();

    const parsed = parseCodeReviewGateFromChangedFiles(ctx.taskRepoCwd, ctx.relativePaths);
    if (!parsed) return Promise.resolve();

    const { sourceFile, mergeAllowed, gateResult } = parsed;

    for (const paramKey of paramKeys) {
      const value_json =
        paramKey === CODE_REVIEW_GATE_PARAM_KEY.CodeReviewMergeAllowed
          ? JSON.stringify(mergeAllowed)
          : JSON.stringify(gateResult);

      upsertParentTaskParam(ctx.db, {
        id: randomUUID(),
        parent_task_id: ctx.parentTaskId,
        param_key: paramKey,
        value_json,
        description: `Agent 输出文件解析的 Code Review 门禁（${codeReviewGateParamKeyLabel(paramKey)}，来源 ${sourceFile}）`,
      });
    }
    return Promise.resolve();
  },
};
