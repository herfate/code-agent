import { normalizeGitRemoteUrlStored, type GitRepoInitPair } from "../../db/gitRepoPair.js";

const DEFAULT_CODE_REPO_BRANCH = "master";

/** 解析 `wiki_source` 中「代码地址」的 `wiki_url`（JSON 或纯 Git URL） */
export function parseCodeRepoWikiUrl(wikiUrl: string): GitRepoInitPair | null {
  const t = wikiUrl.trim();
  if (!t) return null;
  try {
    const raw = JSON.parse(t) as unknown;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      const gitRemoteUrl =
        typeof o.gitRemoteUrl === "string" ? normalizeGitRemoteUrlStored(o.gitRemoteUrl) : "";
      const branch_version =
        typeof o.branch_version === "string" ? o.branch_version.trim() : "";
      if (!gitRemoteUrl) return null;
      return { gitRemoteUrl, branch_version: branch_version || DEFAULT_CODE_REPO_BRANCH };
    }
  } catch {
    /* 非 JSON 则按纯 URL 处理 */
  }
  const gitRemoteUrl = normalizeGitRemoteUrlStored(t);
  if (!gitRemoteUrl) return null;
  return { gitRemoteUrl, branch_version: DEFAULT_CODE_REPO_BRANCH };
}
