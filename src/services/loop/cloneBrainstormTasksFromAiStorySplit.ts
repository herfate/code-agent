import type { DatabaseSync } from "node:sqlite";
import {
  TASK_STATUS,
  TASK_TYPE,
  deleteTask,
  getTask,
  listTasksByPid,
  type TaskRow,
} from "../../db/workflow.js";
import type { AiStorySplitFragment } from "../file/parseTaskOutAiStorySplitResult.js";
import { AppLog } from "../appLogger.js";
import { cloneTaskAsPending } from "./cloneTasksOnTestNotFullyPassed.js";

export type CloneBrainstormTasksFromAiStorySplitResult = {
  fragments: AiStorySplitFragment[];
  brainstormTasks: TaskRow[];
};

/** 删除同父任务下仍为 Pending 的头脑风暴占位任务（编排时预创建） */
function deletePendingBrainstormTasks(db: DatabaseSync, parentTaskId: string): number {
  let count = 0;
  for (const task of listTasksByPid(db, parentTaskId)) {
    if (task.task_type !== TASK_TYPE.Brainstorm || task.status !== TASK_STATUS.Pending) {
      continue;
    }
    if (deleteTask(db, task.id)) {
      count += 1;
    }
  }
  return count;
}

/**
 * AI 拆分故事完成：按 story_N.md 正文为含中文的分片复制 Pending 头脑风暴任务。
 */
export function cloneBrainstormTasksFromAiStorySplit(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskId: string,
  fragments: AiStorySplitFragment[],
): CloneBrainstormTasksFromAiStorySplitResult | null {
  const executing = getTask(db, executingTaskId);
  if (!executing || executing.pid !== parentTaskId) {
    AppLog.logger.warn(
      { parentTaskId, executingTaskId },
      "cloneBrainstormTasksFromAiStorySplit: executing task not found",
    );
    return null;
  }
  if (executing.task_type !== TASK_TYPE.AiStorySplit) {
    return null;
  }

  if (fragments.length === 0) {
    AppLog.logger.info(
      { parentTaskId, executingTaskId },
      "cloneBrainstormTasksFromAiStorySplit: no chinese fragments, skip clone",
    );
    return null;
  }

  const tasks = listTasksByPid(db, parentTaskId);
  const sourceBrainstorm = tasks.find((t) => t.task_type === TASK_TYPE.Brainstorm);
  if (!sourceBrainstorm) {
    AppLog.logger.warn(
      { parentTaskId },
      "cloneBrainstormTasksFromAiStorySplit: no brainstorm task under parent",
    );
    return null;
  }

  const deleted = deletePendingBrainstormTasks(db, parentTaskId);
  const brainstormTasks: TaskRow[] = [];
  for (let i = 0; i < fragments.length; i += 1) {
    const fragment = fragments[i]!;
    const brainstormTask = cloneTaskAsPending(db, sourceBrainstorm, {
      description: fragment.content,
      created_at: executing.created_at + i + 1,
      task_type: TASK_TYPE.Brainstorm,
    });
    brainstormTasks.push(brainstormTask);
  }

  AppLog.logger.info(
    {
      parentTaskId,
      executingTaskId,
      deletedPendingBrainstorm: deleted,
      fragmentCount: fragments.length,
      storyIndexes: fragments.map((f) => f.index),
      newBrainstormTaskIds: brainstormTasks.map((t) => t.id),
    },
    "cloneBrainstormTasksFromAiStorySplit: cloned brainstorm tasks from story_N.md",
  );

  return { fragments, brainstormTasks };
}
