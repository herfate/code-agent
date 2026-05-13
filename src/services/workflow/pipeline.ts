import { DEFAULT_CHANGED_FILES_HANDLERS } from "./handlers/index.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "./types.js";

/** 按注册顺序执行支持当前 `task_type` 的变更文件处理器 */
export async function runParentTaskChangedFilesPipeline(
  ctx: ParentTaskChangedFilesContext,
  handlers: ParentTaskChangedFilesHandler[] = DEFAULT_CHANGED_FILES_HANDLERS,
): Promise<void> {
  for (const h of handlers) {
    if (h.supports(ctx.taskType)) {
      await h.handle(ctx);
    }
  }
}
