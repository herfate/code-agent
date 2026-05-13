/** Agent 变更文件输出根目录名（相对项目 cwd：`ai_out/<pid>/<taskType>/`） */
export const AI_OUT_DIR = "ai_out";

/** 初始运行参数（`value_json` 为 `ParentTaskInitJson`，见 `parentTask.ts`） */
export const PARENT_PARAM_KEY_INIT = "init";

import { CHANGED_FILES_TYPE } from "./changedFilesType.js";
import { TEST_PASS_RATE_PARAM_KEY } from "./testPassRateParamKey.js";

/** 创建父任务时禁止通过 `extraParams` 传入的保留键（含变更文件、通过率等 Agent 落库键） */
export const RESERVED_PARENT_PARAM_KEYS = [
  PARENT_PARAM_KEY_INIT,
  CHANGED_FILES_TYPE.DesignOut,
  CHANGED_FILES_TYPE.TestDataAnalysisOut,
  CHANGED_FILES_TYPE.TestPreAnalysisOut,
  CHANGED_FILES_TYPE.TestCaseDesignOut,
  ...Object.values(TEST_PASS_RATE_PARAM_KEY),
] as const;
