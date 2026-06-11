import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import { TASK_TYPE, type TaskType } from "../../constants/taskType.js";
import { getParentTask } from "../../db/parentTask.js";
import { listTaskInputGitRepos, type TaskInputJson } from "../../db/taskInputJson.js";
import { AppLog } from "../appLogger.js";
import { filterRepoSourceRelPaths, hasUiSourceRelPaths } from "../file/repoArtifactFilter.js";
import { cloneUiTestExecuteFromDesign } from "../loop/cloneUiTestExecuteFromDesign.js";
import {
  applyHttpsTokenToRemoteUrl,
  getGitlabUserToken,
} from "../tools/gitlabTool.js";
import { gitCliArgs } from "../tools/gitExec.js";
import {
  groupChangedPathsByRepoWorkspace,
  planGitRepoWorkspaceDirs,
  resolveGitRepoWorkspacePath,
} from "../tools/gitRepoWorkspace.js";

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
  /** 当前认领执行的开发任务 id（提交成功后可据此克隆 UI 测试任务） */
  executingTaskId: string;
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
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const r = await execFileAsync("git", gitCliArgs(args), {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
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

/** 从 git 远程地址解析 GitLab 项目路径与 API 根地址 */
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

/** 由任务创建人构造 git author 邮箱（仅用于 commit 元数据） */
function buildAuthorEmail(creator: string): string {
  return `${creator}@howbuy.com`;
}

async function commitAndPushDevBranch(input: {
  repoPath: string;
  gitRemoteUrl: string;
  token: string;
  httpsTokenUsername?: string;
  /** 任务 `creator`，作为 git commit 的 author / committer 用户名 */
  authorName?: string;
  sourceBranch: string;
  relativePaths: string[];
  commitMessage: string;
}): Promise<void> {
  const repo = path.resolve(input.repoPath);
  if (!existsSync(path.join(repo, ".git"))) {
    throw new Error(`不是 git 仓库: ${repo}`);
  }

  const pathsToStage = filterRepoSourceRelPaths(input.relativePaths);
  if (pathsToStage.length === 0) {
    throw new Error("无有效源码变更可提交（已排除 target/build 等构建产物）");
  }
  for (const rel of pathsToStage) {
    await runGit(["add", "--", rel], { cwd: repo });
  }
  const authorName = input.authorName?.trim();
  const commitEnv = authorName
    ? {
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: buildAuthorEmail(authorName),
        GIT_COMMITTER_NAME: authorName,
        GIT_COMMITTER_EMAIL: buildAuthorEmail(authorName),
      }
    : undefined;
  await runGit(["commit", "-m", input.commitMessage], { cwd: repo, env: commitEnv });

  const pushRemote = applyHttpsTokenToRemoteUrl(
    input.gitRemoteUrl.trim(),
    input.token,
    input.httpsTokenUsername,
  );
  await runGit(["remote", "set-url", "origin", pushRemote], { cwd: repo });
  await runGit(["push", "-u", "origin", input.sourceBranch], { cwd: repo });
}

/**
 * 开发任务（task_type = 1）完成后按仓库提交变更。
 * 单仓库提交到工作区根；多仓库按子目录分别 commit/push，路径规划与 {@link prepareClaimedTaskRepoWorkspace} 一致。
 */
export async function tryCreateDevMergeRequest(input: TryCreateDevMrInput): Promise<void> {
  const log = AppLog.logger;
  const {
    db,
    taskInputJson,
    creator,
    taskRepoCwd,
    parentTaskId,
    executingTaskId,
    executingTaskType,
    relativePaths,
  } = input;

  if (executingTaskType !== TASK_TYPE.Dev) return;
  if (relativePaths.length === 0) {
    log.info({ parentTaskId }, "dev MR: 无变更文件，跳过");
    return;
  }

  const repos = listTaskInputGitRepos(taskInputJson);
  if (repos.length === 0) {
    log.info({ parentTaskId }, "dev MR: 无 gitRepos（与 clone 跳过一致），跳过");
    return;
  }

  const token = getGitlabUserToken(db, creator);
  if (!token) {
    log.warn({ parentTaskId, creator }, "dev MR: 用户 system_config 未配置 gitlab_token，跳过");
    return;
  }

  const httpsTokenUsername = creator?.trim() || undefined;
  const parent = getParentTask(db, parentTaskId);
  const taskTitle = parent?.title?.trim() || parentTaskId;
  const plans = planGitRepoWorkspaceDirs(repos);
  const pathsByRepo = groupChangedPathsByRepoWorkspace(relativePaths, plans);

  let anyCommitted = false;
  for (const plan of plans) {
    const repoPaths = pathsByRepo.get(plan.relDir) ?? [];
    if (repoPaths.length === 0) continue;

    if (!plan.branch_version.trim()) {
      log.warn({ parentTaskId, gitRemoteUrl: plan.gitRemoteUrl }, "dev MR: 缺少 branch_version，跳过该仓库");
      continue;
    }

    const project = parseGitLabProjectFromRemote(plan.gitRemoteUrl);
    if (!project) {
      log.warn({ parentTaskId, gitRemoteUrl: plan.gitRemoteUrl }, "dev MR: 无法解析 GitLab 项目路径，跳过该仓库");
      continue;
    }

    const targetBranch = plan.branch_version.trim();
    const commitMessage = `feat(${targetBranch}): ${taskTitle.replace(/\s+/g, " ")}`;
    const repoPath = resolveGitRepoWorkspacePath(taskRepoCwd, plan.relDir);

    try {
      await commitAndPushDevBranch({
        repoPath,
        gitRemoteUrl: plan.gitRemoteUrl,
        token,
        httpsTokenUsername,
        authorName: httpsTokenUsername,
        sourceBranch: targetBranch,
        relativePaths: repoPaths,
        commitMessage,
      });
      anyCommitted = true;
      log.info(
        { parentTaskId, gitRemoteUrl: plan.gitRemoteUrl, targetBranch, fileCount: repoPaths.length },
        "dev git: 已提交并推送",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ parentTaskId, gitRemoteUrl: plan.gitRemoteUrl, err: msg }, "dev git: 提交 git 失败");
    }
  }

  // 至少有一次提交成功，且变更含 js/vue/jsp/html：复制 Design 生成 UI 测试执行（每父任务仅一次）
  if (anyCommitted && hasUiSourceRelPaths(relativePaths)) {
    cloneUiTestExecuteFromDesign(db, parentTaskId, executingTaskId);
  }
}
