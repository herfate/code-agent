import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { AI_OUT_DIR } from "../../../constants/commonKey.js";
import { changedFilesParamKeyForTaskType } from "../../../constants/changedFilesType.js";
import type { TaskType } from "../../../constants/taskType.js";
import type { ParentTaskChangedFilesContext, ParentTaskChangedFilesHandler } from "../types.js";

/** 设计 / 测试数据分析：将变更文件复制到 `ai_out/<pid>/<taskType>/` */
export const copyChangedFilesToAiOutHandler: ParentTaskChangedFilesHandler = {
  supports(taskType: TaskType): boolean {
    return changedFilesParamKeyForTaskType(taskType) !== null;
  },

  handle(ctx: ParentTaskChangedFilesContext): Promise<void> {
    const { relativePaths } = ctx;
    if (relativePaths.length === 0) return Promise.resolve();

    const outRoot = join(process.cwd(), AI_OUT_DIR, ctx.parentTaskId, String(ctx.taskType));
    mkdirSync(outRoot, { recursive: true });

    for (const rel of relativePaths) {
      const src = join(ctx.taskRepoCwd, rel);
      if (!existsSync(src)) continue;
      const dest = join(outRoot, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
    return Promise.resolve();
  },
};
