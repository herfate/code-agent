import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { AI_OUT_DIR } from "../../constants/commonKey.js";
import { isTaskType, type TaskType } from "../../constants/taskType.js";
import {
  parseAutotestCaseContent,
  type AutotestCaseFileDoc,
} from "./parseAutotestCaseJson.js";

export type AutotestCaseJsonInAiOut = AutotestCaseFileDoc & {
  pid: string;
  task_type: TaskType;
  content: string;
  updated_at: number;
};

type JsonFileCandidate = {
  taskType: TaskType;
  relativePath: string;
  absPath: string;
  mtimeMs: number;
};

/** ai_out 中扫描到的 Markdown 文档 */
export type AutotestMdInAiOut = {
  pid: string;
  task_type: TaskType;
  relative_path: string;
  content: string;
  updated_at: number;
};

function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

/** `test_cases_manifest.md` 优先排在前面 */
function compareMdRelativePath(a: string, b: string): number {
  const rank = (p: string) => {
    const base = p.split("/").pop()?.toLowerCase() ?? "";
    if (base === "test_cases_manifest.md") return 0;
    return 1;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "zh-CN");
}

function assertSafePid(pid: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(pid)) {
    throw new Error("invalid pid");
  }
}

function aiOutRoot(): string {
  return resolve(process.cwd(), AI_OUT_DIR);
}

function assertUnderAiOutRoot(absPath: string): void {
  const root = aiOutRoot();
  const normalized = resolve(absPath);
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error("path outside ai_out");
  }
}

function listTaskTypeDirs(pidDir: string): TaskType[] {
  if (!existsSync(pidDir)) return [];
  assertUnderAiOutRoot(pidDir);
  const types: TaskType[] = [];
  for (const ent of readdirSync(pidDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const n = Number(ent.name);
    if (isTaskType(n)) types.push(n);
  }
  return types;
}

/** 递归收集目录下全部 `.json` 文件 */
function collectJsonFiles(
  dir: string,
  taskTypeRoot: string,
  taskType: TaskType,
  out: JsonFileCandidate[],
): void {
  if (!existsSync(dir)) return;
  assertUnderAiOutRoot(dir);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      collectJsonFiles(abs, taskTypeRoot, taskType, out);
      continue;
    }
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith(".json")) continue;
    if (ent.name.toLowerCase() === "script.json") continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    out.push({
      taskType,
      relativePath: relative(taskTypeRoot, abs).replace(/\\/g, "/"),
      absPath: abs,
      mtimeMs: st.mtimeMs,
    });
  }
}

/** 递归收集目录下全部 Markdown 文件 */
function collectMdFiles(
  dir: string,
  taskTypeRoot: string,
  taskType: TaskType,
  out: JsonFileCandidate[],
): void {
  if (!existsSync(dir)) return;
  assertUnderAiOutRoot(dir);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      collectMdFiles(abs, taskTypeRoot, taskType, out);
      continue;
    }
    if (!ent.isFile() || !isMarkdownFile(ent.name)) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    out.push({
      taskType,
      relativePath: relative(taskTypeRoot, abs).replace(/\\/g, "/"),
      absPath: abs,
      mtimeMs: st.mtimeMs,
    });
  }
}

/**
 * 在 `ai_out/<pid>/` 下扫描全部 `.md` / `.markdown` 文件。
 * `test_cases_manifest.md` 排在最前。
 */
export function findAutotestMdFilesInAiOut(pid: string): AutotestMdInAiOut[] {
  assertSafePid(pid);
  const pidDir = join(aiOutRoot(), pid);
  assertUnderAiOutRoot(pidDir);

  const candidates: JsonFileCandidate[] = [];
  for (const tt of listTaskTypeDirs(pidDir)) {
    const typeDir = join(pidDir, String(tt));
    collectMdFiles(typeDir, typeDir, tt, candidates);
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => compareMdRelativePath(a.relativePath, b.relativePath));

  const results: AutotestMdInAiOut[] = [];
  for (const c of candidates) {
    let content: string;
    try {
      content = readFileSync(c.absPath, "utf8");
    } catch {
      continue;
    }
    results.push({
      pid,
      task_type: c.taskType,
      relative_path: c.relativePath,
      content,
      updated_at: c.mtimeMs,
    });
  }

  return results;
}

/**
 * 在 `ai_out/<pid>/` 下扫描全部符合自动化测试案例规范的 `.json` 文件。
 * 按相对路径排序，便于 Excel sheet 顺序稳定。
 */
export function findAutotestCaseJsonFilesInAiOut(pid: string): AutotestCaseJsonInAiOut[] {
  assertSafePid(pid);
  const pidDir = join(aiOutRoot(), pid);
  assertUnderAiOutRoot(pidDir);

  const candidates: JsonFileCandidate[] = [];
  for (const tt of listTaskTypeDirs(pidDir)) {
    const typeDir = join(pidDir, String(tt));
    collectJsonFiles(typeDir, typeDir, tt, candidates);
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));

  const results: AutotestCaseJsonInAiOut[] = [];
  for (const c of candidates) {
    let content: string;
    try {
      content = readFileSync(c.absPath, "utf8");
    } catch {
      continue;
    }
    const doc = parseAutotestCaseContent(content, c.relativePath);
    if (!doc) continue;
    results.push({
      ...doc,
      pid,
      task_type: c.taskType,
      content,
      updated_at: c.mtimeMs,
    });
  }

  return results;
}
