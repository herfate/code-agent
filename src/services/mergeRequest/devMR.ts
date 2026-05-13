import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import { TASK_TYPE, type TaskType } from "../../constants/taskType.js";
import type { TaskInputJson } from "../../db/taskInputJson.js";
import { AppLog } from "../appLogger.js";
import {
  applyHttpsTokenToRemoteUrl,
  getGitlabUserToken,
} from "../tools/gitlabTool.js";

const execFileAsync = promisify(execFile);

/** 与 {@link prepareClaimedTaskRepoWorkspace} 对齐的 GitLab 上下文 */
export type DevMrGitContext = {
  db: DatabaseSync;
  /** 已由 {@link parseTaskInputJson} 解析的 `tasks.input_json` */
  taskInputJson: TaskInputJson;
  /** `tasks.creator`：HTTPS 鉴权用户名；空则 clone/push 使用 `oauth2` */
  creator: string | null;
  taskRepoCwd: string;
};

export type TryCreateDevMrInput = DevMrGitContext & {
  parentTaskId: string;
  /** 当前认领执行的任务类型 */
  executingTaskType: TaskType;
  relativePaths: string[];
};

type GitLabProjectRef = {
  apiOrigin: string;
  projectPath: string;
};

async function runGit(
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const r = await execFileAsync("git", args, {
      cwd: opts.cwd,
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    });
    const stdout = Buffer.isBuffer(r.stdout) ? r.stdout.toString("utf8") : String(r.stdout);
    const stderr = Buffer.isBuffer(r.stderr) ? r.stderr.toString("utf8") : String(r.stderr);
    return { stdout, stderr };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer; stdout?: Buffer };
    const stderr = err.stderr?.toString("utf8")?.trim() ?? "";
    const stdout = err.stdout?.toString("utf8")?.trim() ?? "";
    const tail = [stderr, stdout].filter(Boolean).join("\n").slice(0, 2000);
    const hint = err.code === "ENOENT" ? "（本机未安装 git 或未加入 PATH）" : "";
    throw new Error(`git ${args.join(" ")} 失败${hint}: ${tail || err.message}`);
  }
}

/** 从 `taskInputJson.gitRemoteUrl` 解析 GitLab 项目路径与 API 根地址 */
function parseGitLabProjectFromRemote(gitRemoteUrl: string): GitLabProjectRef | null {
  const raw = gitRemoteUrl.trim();
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    return null;
  }
  const projectPath = u.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!projectPath) return null;
  return { apiOrigin: `${u.protocol}//${u.host}`, projectPath };
}

/** 基于克隆时的目标分支（`branch_version`）生成 MR 源分支：`{baseBranch}-ai-{timestamp}` */
function buildSourceBranchName(baseBranch: string): string {
  const safe = baseBranch.replace(/[^a-zA-Z0-9/._-]/g, "-");
  const suffix = `-ai-${Date.now()}`;
  const maxBaseLen = Math.max(1, 255 - suffix.length);
  const base = safe.length > maxBaseLen ? safe.slice(0, maxBaseLen) : safe;
  return `${base}${suffix}`;
}

async function commitAndPushDevBranch(input: {
  repoPath: string;
  gitRemoteUrl: string;
  token: string;
  httpsTokenUsername?: string;
  sourceBranch: string;
  relativePaths: string[];
  commitMessage: string;
}): Promise<void> {
  const repo = path.resolve(input.repoPath);
  if (!existsSync(path.join(repo, ".git"))) {
    throw new Error(`不是 git 仓库: ${repo}`);
  }

  // 因为不需要mr了, 移除
  // await runGit(["checkout", "-b", input.sourceBranch], { cwd: repo });
  for (const rel of input.relativePaths) {
    await runGit(["add", "--", rel], { cwd: repo });
  }
  await runGit(["commit", "-m", input.commitMessage], { cwd: repo });

  const pushRemote = applyHttpsTokenToRemoteUrl(
    input.gitRemoteUrl.trim(),
    input.token,
    input.httpsTokenUsername,
  );
  await runGit(["remote", "set-url", "origin", pushRemote], { cwd: repo });
  await runGit(["push", "-u", "origin", input.sourceBranch], { cwd: repo });
}

async function createGitLabMergeRequest(input: {
  apiOrigin: string;
  projectPath: string;
  token: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
}): Promise<{ iid: number; web_url: string }> {
  const encoded = encodeURIComponent(input.projectPath);
  const url = `${input.apiOrigin.replace(/\/+$/, "")}/api/v4/projects/${encoded}/merge_requests`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": input.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_branch: input.sourceBranch,
      target_branch: input.targetBranch,
      title: input.title,
      description: input.description,
      remove_source_branch: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitLab 创建 MR 失败 HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text) as { iid?: number; web_url?: string };
  if (typeof body.iid !== "number" || !body.web_url) {
    throw new Error("GitLab 创建 MR 响应缺少 iid 或 web_url");
  }
  return { iid: body.iid, web_url: body.web_url };
}

/**
 * 开发任务（task_type = 1）完成后发起 MR。
 * 仓库地址、目标分支与 {@link prepareClaimedTaskRepoWorkspace} 相同（`input_json`）；
 * `gitlab_token` 仅从 `system_config` 用户配置读取（`getGitlabUserToken`）。失败仅记日志。
 */
export async function tryCreateDevMergeRequest(input: TryCreateDevMrInput): Promise<void> {
  const log = AppLog.logger;
  const { db, taskInputJson, creator, taskRepoCwd, parentTaskId, executingTaskType, relativePaths } =
    input;

  if (executingTaskType !== TASK_TYPE.Dev) return;
  if (relativePaths.length === 0) {
    log.info({ parentTaskId }, "dev MR: 无变更文件，跳过");
    return;
  }

  const gitRemoteUrl = taskInputJson.gitRemoteUrl?.trim() ?? "";
  const targetBranch = taskInputJson.branch_version?.trim() ?? "";
  if (!gitRemoteUrl) {
    log.info({ parentTaskId }, "dev MR: 无 gitRemoteUrl（与 clone 跳过一致），跳过");
    return;
  }
  if (!targetBranch) {
    log.warn({ parentTaskId }, "dev MR: 缺少 branch_version，跳过");
    return;
  }

  const project = parseGitLabProjectFromRemote(gitRemoteUrl);
  if (!project) {
    log.warn({ parentTaskId }, "dev MR: 无法解析 GitLab 项目路径，跳过");
    return;
  }

  const token = getGitlabUserToken(db, creator);
  if (!token) {
    log.warn({ parentTaskId, creator }, "dev MR: 用户 system_config 未配置 gitlab_token，跳过");
    return;
  }

  // const sourceBranch = buildSourceBranchName(targetBranch);
  const commitMessage = `AI dev: ${parentTaskId}`;
  const httpsTokenUsername = creator?.trim() || undefined;

  try {
    // 直接提交该分支代码
    await commitAndPushDevBranch({
      repoPath: taskRepoCwd,
      gitRemoteUrl,
      token,
      httpsTokenUsername,
      sourceBranch: targetBranch,
      relativePaths,
      commitMessage,
    });

    // 移除mr, 直接提交代码
  /*  const mr = await createGitLabMergeRequest({
      apiOrigin: project.apiOrigin,
      projectPath: project.projectPath,
      token,
      sourceBranch,
      targetBranch,
      title: commitMessage,
      description: `由 code-agent 开发任务自动提交。\n\n父任务: ${parentTaskId}\n变更文件数: ${relativePaths.length}`,
    });

    log.info(
      { parentTaskId, sourceBranch, targetBranch, mrIid: mr.iid, mrUrl: mr.web_url },
      "dev MR: 已创建 Merge Request",
    );*/
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ parentTaskId, err: msg }, "dev git: 提交git 失败");
  }
}
