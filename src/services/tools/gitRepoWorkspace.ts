import path from "node:path";
import type { GitRepoInitPair } from "../../db/gitRepoPair.js";
import { normalizeGitRemoteUrlStored } from "../../db/gitRepoPair.js";

/** 认领任务工作区内单个仓库的目录规划 */
export type GitRepoWorkspacePlan = GitRepoInitPair & {
  /** 相对 `taskRepoCwd` 的子目录；单仓库时为 `""`（克隆到工作区根） */
  relDir: string;
};

/** 从 Git 远程 URL 推导工作区子目录名（取 path 最后一段） */
export function repoDirNameFromGitRemoteUrl(gitRemoteUrl: string): string {
  const normalized = normalizeGitRemoteUrlStored(gitRemoteUrl);
  const withProto = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
  try {
    const u = new URL(withProto);
    const parts = u.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    const last = parts[parts.length - 1] || "repo";
    const safe = last.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
    return safe || "repo";
  } catch {
    return "repo";
  }
}

/** 规划各仓库在工作区内的相对目录（单仓库用根目录，多仓库用唯一子目录） */
export function planGitRepoWorkspaceDirs(repos: GitRepoInitPair[]): GitRepoWorkspacePlan[] {
  const list = repos.filter((r) => r.gitRemoteUrl.trim());
  if (list.length <= 1) {
    return list.map((r) => ({ ...r, relDir: "" }));
  }
  const used = new Set<string>();
  return list.map((r) => {
    const base = repoDirNameFromGitRemoteUrl(r.gitRemoteUrl);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}-${n++}`;
    }
    used.add(name);
    return { ...r, relDir: name };
  });
}

/** 智能问答始终使用命名子目录，避免与根目录 Confluence 文档冲突 */
export function planWikiQaCloneDirs(repos: GitRepoInitPair[]): GitRepoWorkspacePlan[] {
  const used = new Set<string>();
  return repos.map((r) => {
    const base = repoDirNameFromGitRemoteUrl(r.gitRemoteUrl);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}-${n++}`;
    }
    used.add(name);
    return { ...r, relDir: name };
  });
}

/** 将工作区根下的变更路径按仓库子目录分组（值为仓库内相对路径） */
export function groupChangedPathsByRepoWorkspace(
  relativePaths: string[],
  plans: GitRepoWorkspacePlan[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (plans.length <= 1) {
    map.set("", relativePaths);
    return map;
  }
  for (const rel of relativePaths) {
    const norm = rel.replace(/\\/g, "/").replace(/^\.\/+/, "");
    const plan = plans.find(
      (p) => p.relDir && (norm === p.relDir || norm.startsWith(`${p.relDir}/`)),
    );
    if (!plan) continue;
    const inner = norm === plan.relDir ? "" : norm.slice(plan.relDir.length + 1);
    if (!inner) continue;
    const key = plan.relDir;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(inner);
  }
  return map;
}

/** 仓库在工作区内的绝对路径 */
export function resolveGitRepoWorkspacePath(taskRepoCwd: string, relDir: string): string {
  return relDir ? path.join(taskRepoCwd, relDir) : taskRepoCwd;
}
