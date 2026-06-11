import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { AI_OUT_DIR } from "../../constants/commonKey.js";
import { isTaskType, type TaskType } from "../../constants/taskType.js";
import { parseTestCaseDesignContent, type TestCaseDesignDoc } from "./parseTestCaseDesignJson.js";

export type LatestTestCaseDesignInAiOut = {
  pid: string;
  task_type: TaskType;
  /** 相对 `ai_out/<pid>/<taskType>/` 的路径 */
  relative_path: string;
  content: string;
  doc: TestCaseDesignDoc;
  updated_at: number;
};

type JsonFileCandidate = {
  taskType: TaskType;
  relativePath: string;
  absPath: string;
  mtimeMs: number;
};

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
 * 在 `ai_out/<pid>/` 下扫描全部 `.json`，取 mtime 最新且符合功能测试用例设计规范的文件。
 */
export function findLatestTestCaseDesignInAiOut(pid: string): LatestTestCaseDesignInAiOut | null {
  assertSafePid(pid);
  const pidDir = join(aiOutRoot(), pid);
  assertUnderAiOutRoot(pidDir);

  const candidates: JsonFileCandidate[] = [];
  for (const tt of listTaskTypeDirs(pidDir)) {
    const typeDir = join(pidDir, String(tt));
    collectJsonFiles(typeDir, typeDir, tt, candidates);
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const c of candidates) {
    let content: string;
    try {
      content = readFileSync(c.absPath, "utf8");
    } catch {
      continue;
    }
    const doc = parseTestCaseDesignContent(content);
    if (!doc || doc.cases.length === 0) continue;

    return {
      pid,
      task_type: c.taskType,
      relative_path: c.relativePath,
      content,
      doc,
      updated_at: c.mtimeMs,
    };
  }

  return null;
}
