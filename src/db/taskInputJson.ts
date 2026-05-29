import type { TaskRow } from "./workflow.js";
import type { GitRepoInitPair } from "./gitRepoPair.js";
import { parseGitRepoPairsFromUnknown } from "./gitRepoPair.js";

export type { GitRepoInitPair } from "./gitRepoPair.js";

/** 与 POST /api/tasks、父任务子任务写入的 `tasks.input_json` 对齐 */
export type TaskInputJson = {
  app?: string;
  requirement?: string;
  /** 仓库与分支一对一列表（单仓库时长度为 1） */
  gitRepos: GitRepoInitPair[];
  testEnv?: string;
};

const EMPTY_TASK_INPUT: TaskInputJson = { gitRepos: [] };

/** 将 {@link TaskRow.input_json} 反序列化为结构化对象；空串、非法 JSON、非对象时返回空 gitRepos */
export function parseTaskInputJson(inputJson: string | null): TaskInputJson {
  if (!inputJson?.trim()) return { ...EMPTY_TASK_INPUT };
  try {
    const raw = JSON.parse(inputJson) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...EMPTY_TASK_INPUT };
    const o = raw as Record<string, unknown>;
    const str = (key: string): string | undefined => {
      const v = o[key];
      return typeof v === "string" ? v.trim() || undefined : undefined;
    };
    return {
      app: str("app"),
      requirement: str("requirement"),
      gitRepos: parseGitRepoPairsFromUnknown(o.gitRepos),
      testEnv: str("testEnv"),
    };
  } catch {
    return { ...EMPTY_TASK_INPUT };
  }
}

/** 读取任务 input_json 中的仓库列表 */
export function listTaskInputGitRepos(taskInputJson: TaskInputJson): GitRepoInitPair[] {
  return taskInputJson.gitRepos ?? [];
}
