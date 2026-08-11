import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import {
  assertSafeKnowledgeBaseProjectName,
  KNOWLEDGE_BASE_CATEGORY,
  type KnowledgeBaseCategory,
} from "./promoteToKnowledgeBase.js";

const KNOWLEDGE_BASE_DIR = "knowledge_base";
const PROJECT_DOCS_SUBDIR = ".docs";
const PROJECT_INDEX_FILE = "index.md";

const PREVIEWABLE_SUFFIXES = [".md", ".markdown", ".json", ".txt"] as const;

export type KnowledgeBaseDocMeta = {
  id: string;
  title: string;
  category: string;
  status: string;
  /** 相对项目目录，如 `.docs/naming.md` */
  path: string;
};

export type KnowledgeBaseRepoSummary = {
  project_name: string;
  code_style: KnowledgeBaseDocMeta[];
  business_core: KnowledgeBaseDocMeta[];
};

export type KnowledgeBaseFileContent = {
  category: KnowledgeBaseCategory;
  project_name: string;
  /** 相对项目目录路径 */
  path: string;
  content: string;
};

function knowledgeBaseRoot(): string {
  return resolve(process.cwd(), KNOWLEDGE_BASE_DIR);
}

function assertUnderKnowledgeBase(absPath: string): void {
  const root = knowledgeBaseRoot();
  const normalized = resolve(absPath);
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error("path outside knowledge_base");
  }
}

function isPreviewableFile(name: string): boolean {
  const lower = name.toLowerCase();
  return PREVIEWABLE_SUFFIXES.some((ext) => lower.endsWith(ext));
}

function isSafeProjectDirName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

/** 解析项目 index.md 表格行；跳过表头与占位行 */
function parseProjectIndexDocs(indexText: string): KnowledgeBaseDocMeta[] {
  const docs: KnowledgeBaseDocMeta[] = [];
  const seen = new Set<string>();
  for (const line of indexText.split(/\r?\n/)) {
    if (!/^\|/.test(line) || line.includes("----") || /^\|\s*id\s*\|/i.test(line)) {
      continue;
    }
    const cells = line.split("|").map((c) => c.trim());
    // | id | title | category | status | path |  → split 得空首尾
    if (cells.length < 6) continue;
    const id = cells[1] || "";
    const title = cells[2] || "";
    const category = cells[3] || "";
    const status = cells[4] || "";
    const path = (cells[5] || "").replace(/\\/g, "/");
    if (!path || path === "—" || path === "-") continue;
    if (!path.startsWith(`${PROJECT_DOCS_SUBDIR}/`) && path !== PROJECT_DOCS_SUBDIR) {
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    docs.push({
      id: id || basename(path).replace(/\.(md|markdown|json|txt)$/i, ""),
      title: title || id || basename(path),
      category,
      status,
      path,
    });
  }
  return docs;
}

/** 扫描 `.docs/` 作为 index 缺失时的回退 */
function scanDocsDir(projectDir: string, defaultCategory: KnowledgeBaseCategory): KnowledgeBaseDocMeta[] {
  const docsDir = join(projectDir, PROJECT_DOCS_SUBDIR);
  if (!existsSync(docsDir) || !statSync(docsDir).isDirectory()) {
    return [];
  }
  const docs: KnowledgeBaseDocMeta[] = [];
  for (const name of readdirSync(docsDir)) {
    if (name.startsWith(".")) continue;
    const abs = join(docsDir, name);
    if (!statSync(abs).isFile() || !isPreviewableFile(name)) continue;
    const id = name.replace(/\.(md|markdown|json|txt)$/i, "") || name;
    docs.push({
      id,
      title: id,
      category: defaultCategory,
      status: "candidate",
      path: `${PROJECT_DOCS_SUBDIR}/${name}`.replace(/\\/g, "/"),
    });
  }
  docs.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  return docs;
}

function listDocsForProject(
  category: KnowledgeBaseCategory,
  projectName: string,
): KnowledgeBaseDocMeta[] {
  const projectDir = join(knowledgeBaseRoot(), category, projectName);
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    return [];
  }
  const indexPath = join(projectDir, PROJECT_INDEX_FILE);
  if (existsSync(indexPath) && statSync(indexPath).isFile()) {
    try {
      const fromIndex = parseProjectIndexDocs(readFileSync(indexPath, "utf8"));
      if (fromIndex.length > 0) return fromIndex;
    } catch {
      // 回退扫描 .docs
    }
  }
  return scanDocsDir(projectDir, category);
}

function listProjectNames(category: KnowledgeBaseCategory): string[] {
  const catDir = join(knowledgeBaseRoot(), category);
  if (!existsSync(catDir) || !statSync(catDir).isDirectory()) {
    return [];
  }
  const names: string[] = [];
  for (const name of readdirSync(catDir)) {
    if (name === ".gitkeep" || name.startsWith(".")) continue;
    if (!isSafeProjectDirName(name)) continue;
    const abs = join(catDir, name);
    if (!statSync(abs).isDirectory()) continue;
    names.push(name);
  }
  return names;
}

/**
 * 按 git 仓库（项目目录名）聚合 code-style / business-core 文档列表。
 */
export function listKnowledgeBaseRepos(): KnowledgeBaseRepoSummary[] {
  const map = new Map<string, KnowledgeBaseRepoSummary>();

  const ensure = (name: string): KnowledgeBaseRepoSummary => {
    let row = map.get(name);
    if (!row) {
      row = { project_name: name, code_style: [], business_core: [] };
      map.set(name, row);
    }
    return row;
  };

  for (const name of listProjectNames(KNOWLEDGE_BASE_CATEGORY.CodeStyle)) {
    ensure(name).code_style = listDocsForProject(KNOWLEDGE_BASE_CATEGORY.CodeStyle, name);
  }
  for (const name of listProjectNames(KNOWLEDGE_BASE_CATEGORY.BusinessCore)) {
    ensure(name).business_core = listDocsForProject(KNOWLEDGE_BASE_CATEGORY.BusinessCore, name);
  }

  const repos = Array.from(map.values()).filter(
    (r) => r.code_style.length > 0 || r.business_core.length > 0,
  );
  repos.sort((a, b) => a.project_name.localeCompare(b.project_name, "zh-CN"));
  return repos;
}

/**
 * 读取 `knowledge_base/<category>/<project>/.docs/...` 正文。
 * `path` 为相对项目目录路径（如 `.docs/foo.md`）。
 */
export function readKnowledgeBaseFile(opts: {
  category: KnowledgeBaseCategory;
  project: string;
  path: string;
}): KnowledgeBaseFileContent {
  const category = opts.category;
  if (
    category !== KNOWLEDGE_BASE_CATEGORY.CodeStyle &&
    category !== KNOWLEDGE_BASE_CATEGORY.BusinessCore
  ) {
    throw new Error("invalid knowledge_base category");
  }
  const projectName = assertSafeKnowledgeBaseProjectName(opts.project);
  const relPath = String(opts.path || "")
    .trim()
    .replace(/\\/g, "/");
  if (
    !relPath ||
    relPath.includes("..") ||
    relPath.startsWith("/") ||
    !relPath.startsWith(`${PROJECT_DOCS_SUBDIR}/`)
  ) {
    throw new Error("invalid relative path");
  }
  const fileName = basename(relPath);
  if (!fileName || !isPreviewableFile(fileName)) {
    throw new Error("unsupported file type for knowledge_base");
  }

  const projectDir = join(knowledgeBaseRoot(), category, projectName);
  const docsDir = join(projectDir, PROJECT_DOCS_SUBDIR);
  const absPath = resolve(projectDir, ...relPath.split("/").filter(Boolean));
  assertUnderKnowledgeBase(absPath);
  if (!absPath.startsWith(docsDir + sep) && absPath !== docsDir) {
    throw new Error("path outside knowledge_base project .docs dir");
  }
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    throw new Error("file not found");
  }

  return {
    category,
    project_name: projectName,
    path: relPath,
    content: readFileSync(absPath, "utf8"),
  };
}
