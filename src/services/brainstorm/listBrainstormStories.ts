import { TASK_STATUS } from "../../constants/taskStatus.js";
import { TASK_TYPE } from "../../constants/taskType.js";
import type { TaskRow } from "../../db/workflow.js";
import {
  parseDesignClarificationSummary,
  type DesignClarificationSummary,
} from "../file/parseDesignClarificationSummary.js";
import { readAiOutMarkdownByTaskId } from "../file/readLatestAiOutMarkdown.js";

export type BrainstormStoryAiOut = {
  relative_path: string;
  updated_at: number;
};

export type BrainstormStoryItem = {
  task_id: string;
  title: string;
  description: string;
  status: number;
  created_at: number;
  ai_out: BrainstormStoryAiOut | null;
  clarification: DesignClarificationSummary | null;
};

function filterBrainstormTasks(tasks: TaskRow[]): TaskRow[] {
  return tasks
    .filter(
      (t) => t.task_type === TASK_TYPE.Brainstorm && t.status !== TASK_STATUS.Cancelled,
    )
    .sort((a, b) => a.created_at - b.created_at);
}

/** 按 `ai_out/<pid>/10/<taskId>/` 读取各头脑风暴任务的澄清输出 */
export function listBrainstormStoriesForPid(pid: string, tasks: TaskRow[]): BrainstormStoryItem[] {
  const brainstormTasks = filterBrainstormTasks(tasks);

  return brainstormTasks.map((task) => {
    const doc = readAiOutMarkdownByTaskId(pid, TASK_TYPE.Brainstorm, task.id);
    const clarification = doc ? parseDesignClarificationSummary(doc.content) : null;

    return {
      task_id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      created_at: task.created_at,
      ai_out: doc
        ? { relative_path: doc.relative_path, updated_at: doc.updated_at }
        : null,
      clarification,
    };
  });
}
