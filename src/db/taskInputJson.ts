import type { TaskRow } from "./workflow.js";
import type { GitRepoInitPair } from "./gitRepoPair.js";
import { parseGitRepoPairsFromUnknown } from "./gitRepoPair.js";
import type { DevOpsBranchApplyPayload } from "../services/tools/devOpsBranchApplyClient.js";

export type { GitRepoInitPair } from "./gitRepoPair.js";

/** 与 POST /api/tasks、父任务子任务写入的 `tasks.input_json` 对齐 */
export type TaskInputJson = {
  app?: string;
  /** QA 脚本版本（自动化测试编排） */
  qaVersion?: string;
  /** QA 接口路径 */
  qaApiPath?: string;
  /** QA 脚本 ID */
  scriptId?: string;
  /** QA 标签 ID 列表（findPage `list[].id`） */
  labelIds?: number[];
  requirement?: string;
  /** 仓库与分支一对一列表（单仓库时长度为 1） */
  gitRepos: GitRepoInitPair[];
  testEnv?: string;
  /** 测试脑图所在 wiki_base 分类 ID（`task_type=22` 时使用；`task_type=21` 为自动化用例生成） */
  testScriptRepo?: string;
  /** 使用 trade-mock 辅助测试 */
  useTradeMock?: boolean;
  /** 拉取分支（仅开发自测/自review），勾选后工作流首节点前置 BranchApply */
  pullBranch?: boolean;
  /** TAPD 任务 ID（开启任务关联） */
  tapdTaskId?: string;
  /** 申请拉取分支请求体（`task_type=104` 使用，字段与 iter_apply_api 一致） */
  branchApply?: DevOpsBranchApplyPayload;
};

const EMPTY_TASK_INPUT: TaskInputJson = { gitRepos: [] };

/** 将 {@link TaskRow.input_json} 反序列化为结构化对象；空串、非法 JSON、非对象时返回空 gitRepos */
export function parseTaskInputJson(inputJson: string | null): TaskInputJson {
  if (!inputJson?.trim()) return { ...EMPTY_TASK_INPUT };
  try {
    const raw = JSON.parse(inputJson) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...EMPTY_TASK_INPUT };
    const o = raw as Record<string, unknown>;
    const str = (key: string): string | undefined => {
      const v = o[key];
      return typeof v === "string" ? v.trim() || undefined : undefined;
    };
    const numArray = (key: string): number[] | undefined => {
      const v = o[key];
      if (!Array.isArray(v)) return undefined;
      const items = v
        .map((x) => (typeof x === "number" ? x : typeof x === "string" ? Number(x.trim()) : NaN))
        .filter((n) => Number.isFinite(n) && n > 0);
      return items.length ? items : undefined;
    };
    return {
      app: str("app"),
      qaVersion: str("qaVersion"),
      qaApiPath: str("qaApiPath"),
      scriptId: str("scriptId"),
      labelIds: numArray("labelIds"),
      requirement: str("requirement"),
      gitRepos: parseGitRepoPairsFromUnknown(o.gitRepos),
      testEnv: str("testEnv"),
      testScriptRepo: str("testScriptRepo"),
      useTradeMock: o.useTradeMock === true ? true : undefined,
      pullBranch: o.pullBranch === true ? true : undefined,
      tapdTaskId: str("tapdTaskId"),
      branchApply: parseBranchApplyPayload(o.branchApply),
    };
  } catch {
    return { ...EMPTY_TASK_INPUT };
  }
}

/** 从 input_json.branchApply 解析申请拉取分支请求体；非有效对象时返回 undefined */
function parseBranchApplyPayload(raw: unknown): DevOpsBranchApplyPayload | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const str = (key: string): string | undefined => {
    const v = o[key];
    return typeof v === "string" ? v.trim() || undefined : undefined;
  };
  const v = o.repos_str;
  if (!Array.isArray(v)) return undefined;
  const repos_str = v
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x))
    .map((item) => ({
      repos_path: String(item.repos_path ?? "").trim(),
      module_name: String(item.module_name ?? "").trim(),
    }))
    .filter((item) => item.repos_path || item.module_name);
  if (repos_str.length === 0) return undefined;

  const payload: DevOpsBranchApplyPayload = {
    gitlab_group: str("gitlab_group") ?? "",
    desc: str("desc") ?? "",
    repos_str,
    branch_type: str("branch_type") ?? "",
    is_update_out_dep: str("is_update_out_dep") ?? "0",
    branch_name: str("branch_name") ?? "",
  };
  const deadline = str("deadline");
  if (deadline) payload.deadline = deadline;
  const tapdId = str("tapd_id");
  if (tapdId) payload.tapd_id = tapdId;
  return payload;
}

/** 读取任务 input_json 中的仓库列表 */
export function listTaskInputGitRepos(taskInputJson: TaskInputJson): GitRepoInitPair[] {
  return taskInputJson.gitRepos ?? [];
}
