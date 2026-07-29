import { PARENT_PARAM_KEY_INIT } from "../../../constants/commonKey.js";
import type { TaskType } from "../../../constants/taskType.js";
import { parseParentTaskInitJson } from "../../../db/parentTask.js";
import { getParentTaskParamByParentAndKey } from "../../../db/workflow.js";
import { AppLog } from "../../appLogger.js";
import {
  isTapdSyncDocTaskType,
  syncAiOutDocToTapdStoryComment,
  type TapdSyncDocTaskType,
} from "../../tools/tapdStoryDocSyncService.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 从子任务 input_json 或父任务 init 参数解析 TAPD 关联 */
function resolveTapdTaskId(ctx: ParentTaskChangedFilesContext): string | undefined {
  const fromTask = ctx.gitCtx.taskInputJson.tapdTaskId?.trim();
  if (fromTask) return fromTask;
  const initRow = getParentTaskParamByParentAndKey(ctx.db, ctx.parentTaskId, PARENT_PARAM_KEY_INIT);
  return parseParentTaskInitJson(initRow?.value_json).tapdTaskId?.trim() || undefined;
}

/** TAPD 评论展示名：优先 init.creatorRealName（汉字），否则回退 tasks.creator（拼音账号） */
function resolveTapdCommentAuthor(ctx: ParentTaskChangedFilesContext, creator: string): string {
  const initRow = getParentTaskParamByParentAndKey(ctx.db, ctx.parentTaskId, PARENT_PARAM_KEY_INIT);
  const realName = parseParentTaskInitJson(initRow?.value_json).creatorRealName?.trim();
  return realName || creator;
}

/**
 * 设计 / 测试案例执行 / Code Review / UI 测试执行：任务完成后将 `ai_out` 最新 Markdown 自动同步到 TAPD 需求评论。
 * 须在 {@link copyChangedFilesToAiOutHandler} 之后执行，确保 ai_out 已写入。
 */
export const syncAiOutDocToTapdHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return isTapdSyncDocTaskType(taskType);
  },

  async handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const log = AppLog.logger;

    if (ctx.relativePaths.length === 0) {
      log.info(
        { parentTaskId: ctx.parentTaskId, taskType: ctx.taskType },
        "tapd doc sync: 无变更文件，跳过",
      );
      return;
    }

    const tapdTaskId = resolveTapdTaskId(ctx);
    if (!tapdTaskId) {
      log.info({ parentTaskId: ctx.parentTaskId }, "tapd doc sync: 未配置 TAPD 关联，跳过");
      return;
    }

    const creator = ctx.gitCtx.creator?.trim();
    if (!creator) {
      log.warn({ parentTaskId: ctx.parentTaskId }, "tapd doc sync: 缺少 creator，跳过");
      return;
    }

    const taskType = ctx.taskType as TapdSyncDocTaskType;

    try {
      const result = await syncAiOutDocToTapdStoryComment(ctx.db, {
        tapdTaskId,
        pid: ctx.parentTaskId,
        creator,
        author: resolveTapdCommentAuthor(ctx, creator),
        taskType,
      });
      log.info(
        {
          parentTaskId: ctx.parentTaskId,
          taskType: ctx.taskType,
          comment_id: result.comment_id,
          relative_path: result.relative_path,
          truncated: result.truncated,
        },
        "tapd doc sync: 已同步 ai_out 文档到 TAPD 评论",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(
        { parentTaskId: ctx.parentTaskId, taskType: ctx.taskType, err: msg },
        "tapd doc sync: 同步失败",
      );
    }
  },
};
