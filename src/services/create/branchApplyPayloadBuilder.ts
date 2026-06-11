import { APPS, listAppKeysByGitRemoteUrl } from "../../constants/appCatalog.js";
import type { GitRepoInitPair } from "../../db/gitRepoPair.js";
import type { ParentTaskInitJson } from "../../db/parentTask.js";
import type {
  DevOpsBranchApplyPayload,
  DevOpsBranchApplyReposItem,
} from "../tools/devOpsBranchApplyClient.js";

/** 默认截止日期：当前时间 + 14 天 */
const DEFAULT_DEADLINE_OFFSET_MS = 14 * 24 * 60 * 60 * 1000;

/** 从 gitRemoteUrl 提取 `gitlab_group`（主机后第一段路径，如 `fin`） */
export function extractGitlabGroupFromGitRemoteUrl(gitRemoteUrl: string): string {
  const match = gitRemoteUrl.trim().match(/^https?:\/\/[^/]+\/([^/]+)/i);
  return match?.[1] ?? "";
}

/** 从 gitRemoteUrl 提取 `repos_path`（主机后完整相对路径，去掉 `.git`，如 `fin/fin-console`） */
export function extractReposPathFromGitRemoteUrl(gitRemoteUrl: string): string {
  const match = gitRemoteUrl.trim().match(/^https?:\/\/[^/]+\/(.+)$/i);
  return (match?.[1] ?? "").replace(/\.git$/i, "");
}

/** 从 gitRepos 取首个分支名（同一父任务各仓库分支应一致，取第一个即可） */
function pickFirstBranchName(gitRepos: GitRepoInitPair[]): string {
  return gitRepos[0]?.branch_version?.trim() ?? "";
}

/** 从 gitRepos + 应用目录推导 `repos_str`：`repos_path` 取地址，`module_name` 取目录 `repoId`。
 *  一个 git 地址可能对应多个应用（如 param-center-new 同时对应 param-console 和 param-server），
 *  此时展开为多条，每个 repoId 一条，确保各应用模块都能申请到分支。 */
export function buildBranchApplyReposStr(gitRepos: GitRepoInitPair[]): DevOpsBranchApplyReposItem[] {
  const out: DevOpsBranchApplyReposItem[] = [];
  for (const repo of gitRepos) {
    const gitRemoteUrl = repo.gitRemoteUrl.trim();
    const reposPath = extractReposPathFromGitRemoteUrl(gitRemoteUrl);
    const matchedKeys = listAppKeysByGitRemoteUrl(gitRemoteUrl);
    // 无匹配时仍保留一条（module_name 留空，由调用方/接口侧校验决定是否丢弃）
    const moduleNames = matchedKeys.length > 0 ? matchedKeys.map((k) => APPS[k].repoId) : [""];
    for (const moduleName of moduleNames) {
      out.push({ repos_path: reposPath, module_name: moduleName });
    }
  }
  // 过滤掉 repos_path 与 module_name 同时为空的条目
  return out.filter((item) => item.repos_path || item.module_name);
}

/**
 * 根据 `init` 与需求文本组装 BranchApply 请求体。
 * `branch_type` 固定 `bugfix`；`is_update_out_dep` 默认 `"0"`；`deadline` 取当前时间 + 14 天。
 * `gitRepos` 为空或无法推导出 `branch_name`/`repos_str` 时返回 `null`，由调用方决定是否创建该节点。
 */
export function buildBranchApplyPayloadFromInit(
  init: Pick<ParentTaskInitJson, "gitRepos" | "tapdTaskId">,
  requirement: string,
): DevOpsBranchApplyPayload | null {
  const gitRepos = init.gitRepos ?? [];
  if (gitRepos.length === 0) return null;

  const gitlabGroup = extractGitlabGroupFromGitRemoteUrl(gitRepos[0]!.gitRemoteUrl);
  const branchName = pickFirstBranchName(gitRepos);
  const reposStr = buildBranchApplyReposStr(gitRepos);
  if (!gitlabGroup || !branchName || reposStr.length === 0) return null;

  const payload: DevOpsBranchApplyPayload = {
    deadline: new Date(Date.now() + DEFAULT_DEADLINE_OFFSET_MS).toISOString(),
    desc: branchName,
    gitlab_group: gitlabGroup,
    repos_str: reposStr,
    branch_type: "bugfix",
    is_update_out_dep: "0",
    branch_name: branchName,
  };
  const tapdId = init.tapdTaskId?.trim();
  if (tapdId) payload.tapd_id = tapdId;
  return payload;
}
