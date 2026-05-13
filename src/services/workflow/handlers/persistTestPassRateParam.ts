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

    const { sourceFile, passRate, summary } = parsed;

    for (const paramKey of paramKeys) {
      const value_json =
        paramKey === TEST_PASS_RATE_PARAM_KEY.TestCaseExecutePassRate
          ? JSON.stringify(passRate)
          : JSON.stringify(summary === undefined ? { passRate } : { passRate, summary });

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
