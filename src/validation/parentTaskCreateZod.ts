import { z } from "zod";
import {
  isDevWorkflowParentTaskType,
  isTestEnvRequiredForParentTaskType,
  isTestScriptRepoRequiredForParentTaskType,
  PARENT_AGENT_TYPE,
} from "../constants/parentAgentType.js";
import { isWikiCategoryId } from "../constants/wikiCategory.js";
import { zTaskAgentProviderEnumOptional } from "./agentProviderZod.js";
import { zParentAgentTypeOptional } from "./parentAgentTypeZod.js";
import { zTaskCreator } from "./taskCreatorZod.js";
import {
  formatTapdTaskIdInput,
  isValidTapdTaskId,
  TAPD_TASK_ID_VALIDATION_MESSAGE,
} from "../services/claude/tapdTaskIdFormat.js";

const valueJsonField = z.union([
  z.string().max(100_000),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.number(),
  z.boolean(),
  z.null(),
]);

const createParamItem = z.object({
  id: z.string().uuid().optional(),
  param_key: z.string().trim().min(1).max(200),
  value_json: valueJsonField,
  description: z.string().max(2000).optional(),
});

const gitRepoPair = z.object({
  gitRemoteUrl: z.string().trim().min(1).max(2000),
  branch_version: z.string().trim().min(1).max(500),
});

/** 开发/测试编排类型（1/2/3/5/6）字段必填校验：description + gitRepos 必填，testEnv 按类型判定 */
function refineDevWorkflowParentTaskFields(
  data: {
    task_type?: (typeof PARENT_AGENT_TYPE)[keyof typeof PARENT_AGENT_TYPE];
    description?: string;
    gitRepos: z.infer<typeof gitRepoPair>[];
    testEnv?: string;
    testScriptRepo?: string;
  },
  ctx: z.RefinementCtx,
): void {
  const effectiveType = data.task_type ?? PARENT_AGENT_TYPE.DevSelfTest;
  if (!isDevWorkflowParentTaskType(effectiveType)) return;

  if (!data.description?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "description is required for task_type 1, 2, 3, 5, or 6",
      path: ["description"],
    });
  }
  if (data.gitRepos.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "gitRepos must contain at least one repository for task_type 1, 2, 3, 5, or 6",
      path: ["gitRepos"],
    });
  }
  if (isTestEnvRequiredForParentTaskType(effectiveType) && !data.testEnv?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "testEnv is required for task_type 1, 3, 5, or 6",
      path: ["testEnv"],
    });
  }
  if (isTestScriptRepoRequiredForParentTaskType(effectiveType)) {
    const repoId = data.testScriptRepo?.trim();
    if (!repoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "testScriptRepo is required for task_type 5",
        path: ["testScriptRepo"],
      });
    } else if (!isWikiCategoryId(repoId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "testScriptRepo must be a valid wiki_base category id",
        path: ["testScriptRepo"],
      });
    }
  }
}

/** TAPD 关联：先正则格式化，再校验 `story={id}@tapd-{workspaceId}` */
function refineTapdTaskId(data: { tapdTaskId?: string }, ctx: z.RefinementCtx): void {
  const raw = data.tapdTaskId?.trim();
  if (!raw) return;
  const formatted = formatTapdTaskIdInput(raw);
  if (!isValidTapdTaskId(formatted)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: TAPD_TASK_ID_VALIDATION_MESSAGE,
      path: ["tapdTaskId"],
    });
  }
}

/** POST /api/parent-tasks 请求体校验 */
export const zCreateParentTaskBody = z
  .object({
    /** 省略时由服务端分配为 max(数值型 pid)+1 */
    pid: z.string().trim().min(1).max(200).optional(),
    title: z.string().max(500).optional(),
    description: z.string().max(50_000).optional(),
    task_type: zParentAgentTypeOptional,
    /** 仓库与分支一对一列表（单仓库时长度为 1）；业务 Agent 允许为空（仅复制 Wiki 文档） */
    gitRepos: z.array(gitRepoPair).max(20).default([]),
    testEnv: z.string().trim().min(1).max(200).optional(),
    /** 写入 `init` 参数的 Agent 线路；省略时使用 `TASK_AGENT_PROVIDER` */
    provider: zTaskAgentProviderEnumOptional,
    /** 设计完成直接执行：测试预分析完成后不暂停，自动推进后续子任务 */
    directDevAfterDesign: z.boolean().optional(),
    /** 是否并行：勾选后允许与同创建人当日其他父任务并行调度 */
    parallel: z.boolean().optional(),
    /** 业务 Agent 单故事：跳过拆分故事，仅创建头脑风暴子任务 */
    skipStorySplit: z.boolean().optional(),
    /** 业务 Agent 拆分方式：delimiter=按分隔符(9)、ai=按AI理解(11)；省略则按分隔符 */
    storySplitMode: z.enum(["delimiter", "ai"]).optional(),
    /** 使用 trade-mock 辅助测试 */
    useTradeMock: z.boolean().optional(),
    /** 拉取分支（仅开发自测/自review），勾选后在工作流首节点前置 BranchApply */
    pullBranch: z.boolean().optional(),
    /** TAPD 任务关联（`story={id}@tapd-{workspaceId}`） */
    tapdTaskId: z.string().trim().max(200).optional(),
    /** 创建人汉字姓名（写入 init，供 TAPD 评论人展示） */
    creatorRealName: z.string().trim().min(1).max(200).optional(),
    /** wiki_base 分类 ID；测试案例编排（5）必填，写入 task_type=22 的 input_json */
    testScriptRepo: z.string().trim().min(1).max(20).optional(),
    app: z.string().trim().min(1).max(500).optional(),
    /** QA 脚本版本（自动化测试父任务 type=6，写入子任务 input_json） */
    qaVersion: z.string().trim().min(1).max(200).optional(),
    /** QA 接口路径（自动化测试父任务 type=6） */
    qaApiPath: z.string().trim().min(1).max(2000).optional(),
    /** QA 脚本 ID（由接口路径选项带出） */
    scriptId: z.string().trim().min(1).max(50).optional(),
    /** QA 标签 ID 列表（自动化测试父任务 type=6，取 findPage `list[].id`） */
    labelIds: z.array(z.coerce.number().int().positive()).max(50).optional(),
    requirement: z.string().trim().min(1).max(50_000).optional(),
    creator: zTaskCreator,
    params: z.array(createParamItem).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    refineDevWorkflowParentTaskFields(data, ctx);
    refineTapdTaskId(data, ctx);
  })
  .transform((data) => ({
    ...data,
    tapdTaskId: data.tapdTaskId?.trim() ? formatTapdTaskIdInput(data.tapdTaskId) : undefined,
  }));

export type CreateParentTaskBody = z.infer<typeof zCreateParentTaskBody>;

/** 将请求中的 value_json 规范为存库的 JSON 字符串 */
export function normalizeParentTaskParamValueJson(
  raw: z.infer<typeof valueJsonField>,
): string {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) throw new Error("value_json must not be empty");
    JSON.parse(t);
    return t;
  }
  return JSON.stringify(raw);
}
