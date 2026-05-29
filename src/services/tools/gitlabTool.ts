import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import {
  GITLAB_CONFIG_KEY_HOST,
  GITLAB_CONFIG_KEY_TOKEN,
} from "../../constants/systemConfigKeys.js";
import { parseTaskInputJson, listTaskInputGitRepos, type TaskInputJson } from "../../db/taskInputJson.js";
import { getGlobalConfigByKey, getUserConfigByKey } from "../../db/systemConfig.js";
import { TASK_TYPE, type TaskType } from "../../constants/taskType.js";
import { copyWikiCategoryToDir, resolveWikiCategoryIdFromParent } from "../file/prepareWikiQaDemoWorkspace.js";
import { AppLog } from "../appLogger.js";
import {
  planGitRepoWorkspaceDirs,
  resolveGitRepoWorkspacePath,
} from "./gitRepoWorkspace.js";

const execFileAsync = promisify(execFile);

const TASK_REPO_REMOVE_DELAY_MS = 5000;
const TASK_REPO_REMOVE_RETRY_MS = 2000;
const TASK_REPO_REMOVE_MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 延迟后删除目录，缓解 Windows 上 Agent/杀毒 仍占用文件导致的 EBUSY */
async function removeTaskRepoDirIfExists(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  await sleep(TASK_REPO_REMOVE_DELAY_MS);
  for (let attempt = 1; attempt <= TASK_REPO_REMOVE_MAX_ATTEMPTS; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      const retryable = code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
      if (!retryable || attempt === TASK_REPO_REMOVE_MAX_ATTEMPTS) throw e;
      await sleep(TASK_REPO_REMOVE_RETRY_MS);
    }
  }
}

/** 克隆仓库入参 */
export type CloneRepoInput = {
  /** 远程地址（HTTPS/SSH）；HTTPS 若需鉴权可传 {@link token} 或事先用 {@link buildGitlabHttpsCloneUrl} 拼入 */
  remoteUrl: string;
  /** 克隆后的仓库根目录（克隆前该路径必须不存在） */
  targetPath: string;
  /** 浅克隆深度；不传则全量 */
  depth?: number;
  /** 克隆后直接检出该远程分支 */
  branch?: string;
  /**
   * HTTPS 克隆时注入的 token（含 token 的 URL 勿写入日志）。
   * 仅当 URL 为 `http(s)://` 且尚未带 userinfo 时生效；SSH 或未传 token 则沿用 `remoteUrl`。
   */
  token?: string;
  /**
   * 与 `token` 组合为 Basic 的用户名部分。默认 `oauth2`（GitLab PAT）。
   * 传空串表示仅用 token 作为用户名（如 `https://<token>@github.com/...`）。
   */
  httpsTokenUsername?: string;
  signal?: AbortSignal;
};

/** 在已有仓库内基于起点新建并切换分支 */
export type CreateBranchInput = {
  repoPath: string;
  /** 新分支名（将作为 `git` 字面参数传递） */
  branchName: string;
  /** 新分支起点，如 `main`、`origin/develop`；不传则基于当前 HEAD */
  startPoint?: string;
  signal?: AbortSignal;
};

async function runGit(
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const r = await execFileAsync("git", args, {
      cwd: opts.cwd,
      signal: opts.signal,
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

/**
 * 组装 GitLab HTTPS 克隆地址（私有库常用 `oauth2:<token>`）。
 * 注意：含 token 的 URL 不要写入日志。
 */
export function buildGitlabHttpsCloneUrl(input: {
  /** 主机名，如 `gitlab.com` 或 `git.example.com`（不要带协议） */
  host: string;
  /** 命名空间路径，如 `group` 或 `group/sub` */
  namespacePath: string;
  /** 仓库名，可带或不带 `.git` */
  repo: string;
  token?: string;
}): string {
  const host = input.host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const ns = input.namespacePath.replace(/^\/+|\/+$/g, "");
  const repo = input.repo.replace(/\.git$/i, "");
  const repoPath = `${ns}/${repo}.git`;
  if (input.token) {
    return `https://oauth2:${encodeURIComponent(input.token)}@${host}/${repoPath}`;
  }
  return `https://${host}/${repoPath}`;
}

/** 与 `dbConfig.parseConfigStringValue` 一致，避免 gitlabTool ↔ dbConfig 循环依赖 */
function parseSystemConfigStringValue(valueJson: string): string {
  const t = valueJson.trim();
  if (!t) return "";
  try {
    const v = JSON.parse(valueJson) as unknown;
    if (typeof v === "string") return v;
  } catch {
    /* 非 JSON 则整段作为字面值 */
  }
  return t;
}

/** 从 `system_config` 全局行读取的 GitLab 连接信息 */
export type GitlabGlobalSettings = {
  host: string;
  token?: string;
};

/**
 * 读取全局 GitLab 配置。`gitlab_host` 必填；`gitlab_token` 可选（公开库可留空）。
 * 未配置 host 时返回 `null`。
 */
export function getGitlabGlobalSettings(db: DatabaseSync): GitlabGlobalSettings | null {
  const hostRow = getGlobalConfigByKey(db, GITLAB_CONFIG_KEY_HOST);
  const tokenRow = getGlobalConfigByKey(db, GITLAB_CONFIG_KEY_TOKEN);
  const host = hostRow ? parseSystemConfigStringValue(hostRow.value_json).trim() : "";
  const tokenRaw = tokenRow ? parseSystemConfigStringValue(tokenRow.value_json).trim() : "";
  return { host, token: tokenRaw || undefined };
}

/**
 * 从用户级 `system_config` 读取 GitLab PAT（`gitlab_token`），用于任务认领后按创建人克隆。
 * `username` 与任务 `creator`、管理台用户配置页中的用户名一致；未配置时返回 `undefined`。
 */
export function getGitlabUserToken(db: DatabaseSync, username: string | null | undefined): string | undefined {
  const u = username?.trim();
  if (!u) return undefined;
  const row = getUserConfigByKey(db, u, GITLAB_CONFIG_KEY_TOKEN);
  if (!row) return undefined;
  const raw = parseSystemConfigStringValue(row.value_json).trim();
  return raw || undefined;
}

/**
 * 为 HTTPS 裸地址附加 token（返回值可能含凭据，勿打日志）。
 * 已有 `user:pass@`、非 http(s)、或 token 为空时返回原串 trim 结果。
 */
export function applyHttpsTokenToRemoteUrl(
  remoteUrl: string,
  token: string,
  httpsTokenUsername?: string,
): string {
  const trimmed = remoteUrl.trim();
  const t = token.trim();
  if (!t) return trimmed;
  const low = trimmed.toLowerCase();
  if (!low.startsWith("https://") && !low.startsWith("http://")) {
    return trimmed;
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (u.username || u.password) {
    return trimmed;
  }
  const user = httpsTokenUsername !== undefined ? httpsTokenUsername : "oauth2";
  if (user === "") {
    u.username = t;
    u.password = "";
  } else {
    u.username = user;
    u.password = t;
  }
  return u.toString();
}

/** 浅克隆/全量克隆到 `targetPath`（自动创建父目录） */
export async function cloneRepo(input: CloneRepoInput): Promise<void> {
  const target = path.resolve(input.targetPath);
  const parent = path.dirname(target);
  if (!input.remoteUrl.trim()) {
    throw new Error("cloneRepo: remoteUrl 不能为空");
  }
  mkdirSync(parent, { recursive: true });
  if (existsSync(target)) {
    throw new Error(`cloneRepo: 目标路径已存在: ${target}`);
  }

  const httpsUser = input.httpsTokenUsername?.trim();
  const remoteForGit = applyHttpsTokenToRemoteUrl(
    input.remoteUrl.trim(),
    input.token ?? "",
    httpsUser !== undefined && httpsUser.length > 0 ? httpsUser : undefined,
  );

  const args: string[] = ["clone"];
  if (input.depth != null && input.depth > 0) {
    args.push("--depth", String(Math.floor(input.depth)));
  }
  if (input.branch?.trim()) {
    args.push("--branch", input.branch.trim());
  }
  args.push(remoteForGit, target);

  await runGit(args, { cwd: parent, signal: input.signal });
}

function isWikiBizTaskType(taskType: TaskType | undefined): boolean {
  return taskType === TASK_TYPE.StorySplit || taskType === TASK_TYPE.Brainstorm;
}

/** 认领任务：根据 `input_json.gitlab` 克隆或建空目录；含从 DB 拼 HTTPS；失败时 `onClonePrepFailed` 并返回 `false` */
export type PrepareClaimedTaskRepoWorkspaceInput = {
  db: DatabaseSync;
  /** 已由 {@link parseTaskInputJson} 解析的 `tasks.input_json` */
  taskInputJson: TaskInputJson;
  /** `tasks.creator`：HTTPS 克隆时作为 token 的 Basic 用户名；空则使用 `oauth2` */
  creator: string | null;
  taskRepoCwd: string;
  taskId: string;
  /** 拆分故事 / 头脑风暴时复制 wiki 文档（见 `parent_task_params.wiki_doc`） */
  taskType?: TaskType;
  /** 拼不出地址或 `git clone` 抛错 */
  onClonePrepFailed: (errorMessage: string) => void;
};

export async function prepareClaimedTaskRepoWorkspace(
  input: PrepareClaimedTaskRepoWorkspaceInput,
): Promise<boolean> {
  const { db, taskInputJson, creator, taskRepoCwd, taskId, taskType, onClonePrepFailed } = input;
  const repos = listTaskInputGitRepos(taskInputJson);
  const wikiBizTask = isWikiBizTaskType(taskType);
  const wikiCategoryId = wikiBizTask ? resolveWikiCategoryIdFromParent(db, taskId) : null;

  if (repos.length === 0) {
    mkdirSync(taskRepoCwd, { recursive: true });
  } else {
    try {
      await removeTaskRepoDirIfExists(taskRepoCwd);
      const token = getGitlabUserToken(db, creator);
      const plans = planGitRepoWorkspaceDirs(repos);
      for (const plan of plans) {
        const targetPath = resolveGitRepoWorkspacePath(taskRepoCwd, plan.relDir);
        await cloneRepo({
          remoteUrl: plan.gitRemoteUrl,
          targetPath,
          branch: plan.branch_version,
          token,
          httpsTokenUsername: creator?.trim() || undefined,
        });
      }
      AppLog.logger.info(
        { taskId, taskRepoCwd, repoCount: repos.length },
        "claimed task: git clone finished",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onClonePrepFailed(msg);
      return false;
    }
  }

  if (wikiCategoryId) {
    try {
      const copied = copyWikiCategoryToDir(wikiCategoryId, taskRepoCwd);
      AppLog.logger.info(
        { taskId, taskRepoCwd, wikiCategoryId, copied },
        "claimed task: wiki files copied",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onClonePrepFailed(msg);
      return false;
    }
  } else if (wikiBizTask) {
    AppLog.logger.warn({ taskId, taskType }, "claimed task: wiki_doc category_id missing, skip wiki copy");
  }

  return true;
}

/** 在 `repoPath` 下执行 `git checkout -b`（或带起点的等价行为） */
export async function createBranch(input: CreateBranchInput): Promise<void> {
  const repo = path.resolve(input.repoPath);
  if (!existsSync(path.join(repo, ".git"))) {
    throw new Error(`createBranch: 不是 git 仓库: ${repo}`);
  }
  const name = input.branchName.trim();
  if (!name) {
    throw new Error("createBranch: branchName 不能为空");
  }

  const args: string[] = ["checkout", "-b", name];
  if (input.startPoint?.trim()) {
    args.push(input.startPoint.trim());
  }
  await runGit(args, { cwd: repo, signal: input.signal });
}
