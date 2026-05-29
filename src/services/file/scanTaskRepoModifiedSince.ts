import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isRepoBuildArtifactRelPath, REPO_BUILD_SKIP_DIR_NAMES } from "./repoArtifactFilter.js";

/** 递归收集 `rootDir` 下 mtime 严格大于 `sinceMs` 的文件相对路径（`/` 分隔） */
export function listTaskRepoFilesModifiedSince(rootDir: string, sinceMs: number): string[] {
  if (!existsSync(rootDir)) return [];

  const paths: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isSymbolicLink()) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (REPO_BUILD_SKIP_DIR_NAMES.has(ent.name)) continue;
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const rel = relative(rootDir, full).split("\\").join("/");
      if (isRepoBuildArtifactRelPath(rel)) continue;
      const st = statSync(full);
      if (st.mtimeMs > sinceMs) {
        paths.push(rel);
      }
    }
  };
  walk(rootDir);
  return paths.sort();
}
