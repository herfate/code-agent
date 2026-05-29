/** 仓库 HTTPS 地址与分支的一对一配对（init / input_json 统一结构） */
export type GitRepoInitPair = {
  gitRemoteUrl: string;
  branch_version: string;
};

/** 去掉 Git 远程地址末尾的 .git（仅去尾部一次） */
export function normalizeGitRemoteUrlStored(url: string): string {
  const s = url.trim();
  if (!s) return "";
  return s.replace(/\.git\/?$/i, "");
}

/** 归一化 gitRepos：去重（按 URL）、保序、trim */
export function normalizeGitRepoPairs(gitRepos?: GitRepoInitPair[]): GitRepoInitPair[] {
  const seen = new Set<string>();
  const out: GitRepoInitPair[] = [];
  for (const item of gitRepos ?? []) {
    const gitRemoteUrl = normalizeGitRemoteUrlStored(item.gitRemoteUrl);
    const branch_version = item.branch_version.trim();
    if (!gitRemoteUrl) continue;
    const key = gitRemoteUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ gitRemoteUrl, branch_version });
  }
  return out;
}

/** 从 JSON 字段解析 gitRepos 数组 */
export function parseGitRepoPairsFromUnknown(raw: unknown): GitRepoInitPair[] {
  if (!Array.isArray(raw)) return [];
  const out: GitRepoInitPair[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const gitRemoteUrl =
      typeof rec.gitRemoteUrl === "string" ? normalizeGitRemoteUrlStored(rec.gitRemoteUrl) : "";
    const branch_version =
      typeof rec.branch_version === "string" ? rec.branch_version.trim() : "";
    if (!gitRemoteUrl) continue;
    out.push({ gitRemoteUrl, branch_version });
  }
  return normalizeGitRepoPairs(out);
}
