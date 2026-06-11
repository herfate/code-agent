import { randomUUID } from "node:crypto";
import {
  changedFilesParamKeyForTaskType,
  changedFilesTypeLabel,
} from "../../../constants/changedFilesType.js";
import type { TaskType } from "../../../constants/taskType.js";
import { upsertParentTaskParam } from "../../../db/workflow.js";
import { resolveAiOutStoredRelativePath } from "../../file/aiOutTaskPath.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 设计 / 测试数据分析 / 头脑风暴等：将变更文件路径列表 upsert 到 parent_task_params */
export const persistChangedFilesParamHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return changedFilesParamKeyForTaskType(taskType) !== null;
  },

  handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const paramKey = changedFilesParamKeyForTaskType(ctx.taskType);
    if (!paramKey) return Promise.resolve();

    const storedPaths = ctx.relativePaths.map((rel) =>
      resolveAiOutStoredRelativePath(ctx.executingTaskId, rel),
    );

    upsertParentTaskParam(ctx.db, {
      id: randomUUID(),
      parent_task_id: ctx.parentTaskId,
      param_key: paramKey,
      value_json: JSON.stringify(storedPaths),
      description: `Agent 运行后 task-repo 内更新时间晚于基线的文件相对路径（${changedFilesTypeLabel(paramKey)}）`,
    });
    return Promise.resolve();
  },
};
