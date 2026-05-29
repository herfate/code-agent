/** Agent 变更文件输出根目录名（相对项目 cwd：`ai_out/<pid>/<taskType>/`） */
export const AI_OUT_DIR = "ai_out";

/** Confluence 页面转 Markdown 本地输出目录（相对项目 cwd：`confluence_out/`） */
export const CONFLUENCE_OUT_DIR = "confluence_out";

/** Wiki 知识库根目录（相对项目 cwd：`wiki_base/<categoryId>/`） */
export const WIKI_BASE_DIR = "wiki_base";

/** 父任务 `parent_task_params.param_key`：Wiki 文档来源（拆分故事 / 头脑风暴） */
export const WIKI_DOC_PARAM_KEY = "wiki_doc";

/** 初始运行参数（`value_json` 为 `ParentTaskInitJson`，见 `parentTask.ts`） */
export const PARENT_PARAM_KEY_INIT = "init";

import { CHANGED_FILES_TYPE } from "./changedFilesType.js";
import { CODE_REVIEW_GATE_PARAM_KEY } from "./codeReviewGateParamKey.js";
import { DEV_OPS_DEPLOY_PARAM_KEY } from "./devOpsDeployParamKey.js";
import { TEST_PASS_RATE_PARAM_KEY } from "./testPassRateParamKey.js";

/** 创建父任务时禁止通过 `extraParams` 传入的保留键（含变更文件、通过率等 Agent 落库键） */
export const RESERVED_PARENT_PARAM_KEYS = [
  PARENT_PARAM_KEY_INIT,
  CHANGED_FILES_TYPE.DesignOut,
  CHANGED_FILES_TYPE.TestDataAnalysisOut,
  CHANGED_FILES_TYPE.TestPreAnalysisOut,
  CHANGED_FILES_TYPE.TestCaseDesignOut,
  CHANGED_FILES_TYPE.CodeReviewOut,
  ...Object.values(TEST_PASS_RATE_PARAM_KEY),
  ...Object.values(CODE_REVIEW_GATE_PARAM_KEY),
  ...Object.values(DEV_OPS_DEPLOY_PARAM_KEY),
] as const;
