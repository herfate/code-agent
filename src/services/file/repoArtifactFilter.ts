/** 构建/依赖目录：扫描变更与 git 提交时跳过 */
export const REPO_BUILD_SKIP_DIR_NAMES = new Set([
  ".git",
  ".claude",
  "node_modules",
  "target",
  "build",
  "out",
  "bin",
  ".gradle",
  "dist",
  "__pycache__",
]);

/** 不应纳入变更追踪或 git 提交的文件后缀 */
const REPO_BUILD_SKIP_FILE_SUFFIXES = [".class", ".jar", ".war", ".ear"] as const;

/** 相对路径是否属于构建产物（含位于 target/build 等目录下的文件） */
export function isRepoBuildArtifactRelPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const parts = norm.split("/");
  if (parts.some((p) => REPO_BUILD_SKIP_DIR_NAMES.has(p))) return true;
  const lower = norm.toLowerCase();
  return REPO_BUILD_SKIP_FILE_SUFFIXES.some((ext) => lower.endsWith(ext));
}

/** 过滤掉构建产物，仅保留可提交的源码类路径 */
export function filterRepoSourceRelPaths(relativePaths: string[]): string[] {
  return relativePaths.filter((rel) => !isRepoBuildArtifactRelPath(rel));
}

/** 触发 UI 测试执行任务的前端类源码后缀 */
const UI_SOURCE_FILE_SUFFIXES = [".js", ".vue", ".jsp", ".html"] as const;

/** 相对路径是否为 js / vue / jsp / html 源码 */
export function isUiSourceRelPath(relPath: string): boolean {
  if (isRepoBuildArtifactRelPath(relPath)) return false;
  const lower = relPath.replace(/\\/g, "/").toLowerCase();
  return UI_SOURCE_FILE_SUFFIXES.some((ext) => lower.endsWith(ext));
}

/** 变更列表中是否包含 UI 前端类源码（用于开发提交后生成 UI 测试执行任务） */
export function hasUiSourceRelPaths(relativePaths: string[]): boolean {
  return relativePaths.some((rel) => isUiSourceRelPath(rel));
}
