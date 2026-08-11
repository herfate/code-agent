import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { readAiOutFileByRelativePath } from "./readLatestAiOutMarkdown.js";
import type { TaskType } from "../../constants/taskType.js";

const KNOWLEDGE_BASE_DIR = "knowledge_base";
/** 规范正文目录（相对项目目录） */
const PROJECT_DOCS_SUBDIR = ".docs";
const PROJECT_INDEX_FILE = "index.md";

/** knowledge_base 下可手动落盘的分类 */
export const KNOWLEDGE_BASE_CATEGORY = {
  CodeStyle: "code-style",
  BusinessCore: "business-core",
} as const;

export type KnowledgeBaseCategory =
  (typeof KNOWLEDGE_BASE_CATEGORY)[keyof typeof KNOWLEDGE_BASE_CATEGORY];

export type PromoteToKnowledgeBaseResult = {
  category: KnowledgeBaseCategory;
  project_name: string;
  /** 相对仓库根，如 `knowledge_base/code-style/fds-console/.docs/naming.md` */
  path: string;
  /** 项目索引相对路径，如 `knowledge_base/code-style/fds-console/index.md` */
  index_path: string;
  /** 本次是否新建了项目 index.md */
  index_created: boolean;
  overwritten: boolean;
};

/** 从 gitRemoteUrl 提取主机后完整相对路径（去 `.git`） */
function extractReposPathFromGitRemoteUrl(gitRemoteUrl: string): string {
  const match = gitRemoteUrl.trim().match(/^https?:\/\/[^/]+\/(.+)$/i);
  return (match?.[1] ?? "").replace(/\.git$/i, "");
}

/** 从 git 地址取项目名（路径末段，去 `.git`） */
export function extractProjectNameFromGitRemoteUrl(gitRemoteUrl: string): string {
  const reposPath = extractReposPathFromGitRemoteUrl(gitRemoteUrl);
  const parts = reposPath.split("/").filter(Boolean);
  const last = (parts[parts.length - 1] || "").replace(/\.git$/i, "").trim();
  return last;
}

/** 项目目录名：仅允许安全字符 */
export function assertSafeKnowledgeBaseProjectName(name: string): string {
  const t = String(name || "").trim();
  if (!t || !/^[a-zA-Z0-9._-]+$/.test(t)) {
    throw new Error("invalid project name for knowledge_base");
  }
  return t;
}

/** 取相对路径末段文件名，并校验为可预览扩展名 */
function assertSafeKnowledgeBaseFileName(relativePath: string): string {
  const name = basename(String(relativePath || "").replace(/\\/g, "/")).trim();
  if (!name || name === "." || name === ".." || name.includes("..")) {
    throw new Error("invalid file name");
  }
  const lower = name.toLowerCase();
  if (
    !lower.endsWith(".md") &&
    !lower.endsWith(".markdown") &&
    !lower.endsWith(".json") &&
    !lower.endsWith(".txt")
  ) {
    throw new Error("unsupported file type for knowledge_base");
  }
  return name;
}

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

function categoryLabelZh(category: KnowledgeBaseCategory): string {
  return category === KNOWLEDGE_BASE_CATEGORY.BusinessCore ? "业务知识" : "规范文档";
}

/** 从 Markdown frontmatter 粗取字段（失败则用文件名推导） */
function parseFrontmatterMeta(
  content: string,
  fileName: string,
  defaultCategory: KnowledgeBaseCategory,
): {
  id: string;
  title: string;
  category: string;
  status: string;
} {
  const fallbackId = fileName.replace(/\.(md|markdown|json|txt)$/i, "") || "doc";
  const meta: {
    id: string;
    title: string;
    category: string;
    status: string;
  } = {
    id: fallbackId,
    title: fallbackId,
    category: defaultCategory,
    status: "candidate",
  };
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(content || ""));
  if (!m) return meta;
  const block = m[1] || "";
  const pick = (key: string): string | null => {
    const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
    const hit = re.exec(block);
    if (!hit) return null;
    return String(hit[1] || "")
      .trim()
      .replace(/^["']|["']$/g, "");
  };
  meta.id = pick("id") || meta.id;
  meta.title = pick("title") || meta.title;
  meta.category = pick("category") || meta.category;
  meta.status = pick("status") || meta.status;
  return meta;
}

function buildEmptyProjectIndex(projectName: string, category: KnowledgeBaseCategory): string {
  const kind = categoryLabelZh(category);
  return (
    `# ${projectName} ${kind}索引\n\n` +
    `由 Rule Agent「添加到${kind}」维护。文档位于 \`${PROJECT_DOCS_SUBDIR}/\`。\n\n` +
    `| id | title | category | status | path |\n` +
    `|----|-------|----------|--------|------|\n`
  );
}

/**
 * 在 `knowledge_base/<category>/<projectName>/index.md` 中 upsert 一行（按 path 匹配）。
 * 文件不存在则创建。返回是否新建。
 */
function upsertProjectIndexRow(opts: {
  projectDir: string;
  projectName: string;
  category: KnowledgeBaseCategory;
  id: string;
  title: string;
  docCategory: string;
  status: string;
  /** 相对项目目录的路径，如 `.docs/naming.md` */
  path: string;
}): { indexCreated: boolean } {
  const indexPath = join(opts.projectDir, PROJECT_INDEX_FILE);
  assertUnderKnowledgeBase(indexPath);

  const existed = existsSync(indexPath);
  let text = existed
    ? readFileSync(indexPath, "utf8")
    : buildEmptyProjectIndex(opts.projectName, opts.category);

  const escapeCell = (s: string) => String(s || "").replace(/\|/g, "\\|");
  const newRow =
    `| ${escapeCell(opts.id)} | ${escapeCell(opts.title)} | ${escapeCell(opts.docCategory)} | ${escapeCell(opts.status)} | ${escapeCell(opts.path)} |`;

  const lines = text.split(/\r?\n/);
  const pathNeedle = opts.path.replace(/\\/g, "/");
  let replaced = false;
  const next = lines.map((line) => {
    if (!/^\|/.test(line) || line.includes("----") || /^\|\s*id\s*\|/i.test(line)) {
      return line;
    }
    const cells = line.split("|").map((c) => c.trim());
    const pathCell = cells.length >= 2 ? cells[cells.length - 2] : "";
    if (pathCell.replace(/\\/g, "/") === pathNeedle) {
      replaced = true;
      return newRow;
    }
    if (pathCell === "—" || pathCell === "-" || pathCell === "") {
      if (!replaced) {
        replaced = true;
        return newRow;
      }
    }
    return line;
  });

  if (!replaced) {
    let lastTableIdx = -1;
    for (let i = 0; i < next.length; i++) {
      if (/^\|/.test(next[i] || "")) lastTableIdx = i;
    }
    if (lastTableIdx >= 0) {
      next.splice(lastTableIdx + 1, 0, newRow);
    } else {
      next.push("", newRow);
    }
  }

  const out = next
    .filter((line, _i, arr) => {
      if (!/^\|/.test(line)) return true;
      const cells = line.split("|").map((c) => c.trim());
      const pathCell = cells.length >= 2 ? cells[cells.length - 2] : "";
      if ((pathCell === "—" || pathCell === "-") && arr.some((l) => l.includes(pathNeedle))) {
        return false;
      }
      return true;
    })
    .join("\n");

  if (!existsSync(opts.projectDir)) {
    mkdirSync(opts.projectDir, { recursive: true });
  }
  writeFileSync(indexPath, out.endsWith("\n") ? out : out + "\n", "utf8");
  return { indexCreated: !existed };
}

/**
 * 将 `ai_out` 文档写入 `knowledge_base/<category>/<projectName>/.docs/<fileName>`，
 * 并维护 `knowledge_base/<category>/<projectName>/index.md`（不存在则创建）。
 */
export function promoteAiOutDocToKnowledgeBase(opts: {
  pid: string;
  taskType: TaskType;
  relativePath: string;
  projectName: string;
  category?: KnowledgeBaseCategory;
  /** 省略则从 ai_out 读取 */
  content?: string;
  overwrite?: boolean;
}): PromoteToKnowledgeBaseResult {
  const category = opts.category ?? KNOWLEDGE_BASE_CATEGORY.CodeStyle;
  const projectName = assertSafeKnowledgeBaseProjectName(opts.projectName);
  const fileName = assertSafeKnowledgeBaseFileName(opts.relativePath);

  let content = opts.content;
  if (content == null) {
    const doc = readAiOutFileByRelativePath(opts.pid, opts.taskType, opts.relativePath);
    if (!doc) {
      throw new Error("file not found");
    }
    content = doc.content;
  }

  const projectDir = join(knowledgeBaseRoot(), category, projectName);
  const docsDir = join(projectDir, PROJECT_DOCS_SUBDIR);
  const absPath = resolve(docsDir, fileName);
  assertUnderKnowledgeBase(absPath);
  if (!absPath.startsWith(docsDir + sep)) {
    throw new Error(`path outside knowledge_base ${category} project .docs dir`);
  }

  const existed = existsSync(absPath);
  if (existed && !opts.overwrite) {
    throw new Error("file already exists");
  }

  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }
  writeFileSync(absPath, content, "utf8");

  const relDocPath =
    `${KNOWLEDGE_BASE_DIR}/${category}/${projectName}/${PROJECT_DOCS_SUBDIR}/${fileName}`.replace(
      /\\/g,
      "/",
    );
  const relIndexPath =
    `${KNOWLEDGE_BASE_DIR}/${category}/${projectName}/${PROJECT_INDEX_FILE}`.replace(/\\/g, "/");
  /** 写入项目 index 表用的相对项目目录路径 */
  const indexEntryPath = `${PROJECT_DOCS_SUBDIR}/${fileName}`.replace(/\\/g, "/");
  const meta = parseFrontmatterMeta(content, fileName, category);

  let indexCreated = false;
  try {
    const idx = upsertProjectIndexRow({
      projectDir,
      projectName,
      category,
      id: meta.id,
      title: meta.title,
      docCategory: meta.category,
      status: meta.status,
      path: indexEntryPath,
    });
    indexCreated = idx.indexCreated;
  } catch {
    // 索引更新失败不回滚正文写入
  }

  return {
    category,
    project_name: projectName,
    path: relDocPath,
    index_path: relIndexPath,
    index_created: indexCreated,
    overwritten: existed,
  };
}
