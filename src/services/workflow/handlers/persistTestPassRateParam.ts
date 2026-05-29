import { randomUUID } from "node:crypto";
import {
  TEST_PASS_RATE_PARAM_KEY,
  testPassParamKeysForTaskType,
  testPassRateParamKeyLabel,
} from "../../../constants/testPassRateParamKey.js";
import type { TaskType } from "../../../constants/taskType.js";
import { upsertParentTaskParam } from "../../../db/workflow.js";
import { parseTaskOutPassRateFromChangedFiles } from "../../file/parseTaskOutTestResult.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 测试类 Agent 任务：从输出文件提取通过率与总结，分别 upsert 到 `parent_task_params` */
export const persistTestPassRateParamHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return testPassParamKeysForTaskType(taskType).length > 0;
  },

  handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const paramKeys = testPassParamKeysForTaskType(ctx.taskType);
    if (paramKeys.length === 0) return Promise.resolve();

    const parsed = parseTaskOutPassRateFromChangedFiles(ctx.taskRepoCwd, ctx.relativePaths);
    if (!parsed) return Promise.resolve();

    const { sourceFile, passRate, summary, isCodeProblem } = parsed;

    for (const paramKey of paramKeys) {
      let value_json: string | undefined;
      if (paramKey === TEST_PASS_RATE_PARAM_KEY.TestCaseExecutePassRate) {
        value_json = JSON.stringify(passRate);
      } else if (paramKey === TEST_PASS_RATE_PARAM_KEY.TestCaseExecutePassResult) {
        value_json = JSON.stringify(summary === undefined ? { passRate } : { passRate, summary });
      } else if (paramKey === TEST_PASS_RATE_PARAM_KEY.TestCaseExecuteIsCodeProblem) {
        if (isCodeProblem === undefined) continue;
        value_json = JSON.stringify(isCodeProblem);
      } else {
        continue;
      }

      upsertParentTaskParam(ctx.db, {
        id: randomUUID(),
        parent_task_id: ctx.parentTaskId,
        param_key: paramKey,
        value_json,
        description: `Agent 输出文件解析的测试结果（${testPassRateParamKeyLabel(paramKey)}，来源 ${sourceFile}）`,
      });
    }
    return Promise.resolve();
  },
};
