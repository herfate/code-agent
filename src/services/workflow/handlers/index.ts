import type { ParentTaskChangedFilesHandler } from "../types.js";
import { copyChangedFilesToAiOutHandler } from "./copyChangedFilesToAiOut.js";
import { syncAiOutDocToTapdHandler } from "./syncAiOutDocToTapdHandler.js";
import { devMergeRequestHandler } from "./devMergeRequest.js";
import { persistChangedFilesParamHandler } from "./persistChangedFilesParam.js";
import { cloneBrainstormTasksOnStorySplitHandler } from "./cloneBrainstormTasksOnStorySplitHandler.js";
import { cloneBrainstormTasksOnAiStorySplitHandler } from "./cloneBrainstormTasksOnAiStorySplitHandler.js";
import { cloneTasksOnCodeReviewFailHandler } from "./cloneTasksOnCodeReviewFailHandler.js";
import { cloneTasksOnTestFailHandler } from "./cloneTasksOnTestFailHandler.js";
import { persistCodeReviewGateParamHandler } from "./persistCodeReviewGateParam.js";
import { persistTestPassRateParamHandler } from "./persistTestPassRateParam.js";
import { saveDescription4TasksUnderParentHandler } from "./saveDescription4TasksUnderParent.js";

/**
 * 默认变更文件处理链（按顺序执行，各 handler 自行 `supports` 过滤）。
 * 顺序：复制 ai_out → TAPD 文档评论同步 → 更新子任务 description → 落库 param → 开发 MR。
 * 新增任务类型：新建 `handlers/xxx.ts` 并在此数组按依赖顺序注册。
 */
export const DEFAULT_CHANGED_FILES_HANDLERS: ParentTaskChangedFilesHandler[] = [
  copyChangedFilesToAiOutHandler,
  syncAiOutDocToTapdHandler,
  saveDescription4TasksUnderParentHandler,
  persistChangedFilesParamHandler,
  persistTestPassRateParamHandler,
  persistCodeReviewGateParamHandler,
  cloneTasksOnTestFailHandler,
  cloneTasksOnCodeReviewFailHandler,
  cloneBrainstormTasksOnStorySplitHandler,
  cloneBrainstormTasksOnAiStorySplitHandler,
  devMergeRequestHandler,
];
