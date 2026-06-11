import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AI_OUT_DIR } from "../../constants/commonKey.js";
import { TASK_TYPE, type TaskType } from "../../constants/taskType.js";
import { listTasksByPid, updateTask } from "../../db/workflow.js";
import { resolveAiOutStoredRelativePath } from "../file/aiOutTaskPath.js";

/** 按当前执行场景解析要更新 description 的子任务类型；未支持则返回空数组 */
export function resolveDescriptionTargetTaskTypes(executingTaskType: TaskType): TaskType[] {
  switch (executingTaskType) {
    case TASK_TYPE.Design: // 0 设计
      return [TASK_TYPE.Dev/*, TASK_TYPE.CodeReview*/]; // 1 开发 // 8 Code Review
    case TASK_TYPE.TestPreAnalysis: // 测试预分析
      return [TASK_TYPE.TestCaseDesign]; // 测试用例设计
    case TASK_TYPE.TestCaseDesign: // 测试用例设计
      return [TASK_TYPE.TestDataAnalysis]; // 测试数据分析
    case TASK_TYPE.TestDataAnalysis: // 测试数据分析
      return [TASK_TYPE.TestCaseExecute]; // 测试案例执行
    default:
      return []; // 其他场景留空，后续补
  }
}

/** 从 `ai_out/<pid>/<taskType>/<taskId>/` 读取变更文件内容，拼成 description 文本 */
export function updateDescription4Task(
  parentTaskId: string,
  taskType: TaskType,
  executingTaskId: string,
  relativePaths: string[],
): string {
  if (relativePaths.length === 0) return "";

  const outRoot = join(process.cwd(), AI_OUT_DIR, parentTaskId, String(taskType));
  const sections: string[] = [];

  for (const rel of relativePaths) {
    const storedRel = resolveAiOutStoredRelativePath(executingTaskId, rel);
    const filePath = join(outRoot, storedRel);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    sections.push(`${content}`);
  }

  return sections.join("\n\n---\n\n");
}

/**
 * 将最新文件内容写入同父任务下对应子任务 `description`：
 * 0 设计 → 1 开发、8 Code Review；测试流水线各步 → 下一步；其余 `task_type` 暂不处理。
 */
export function saveDescription4TasksUnderParent(
  db: DatabaseSync,
  parentTaskId: string,
  executingTaskType: TaskType,
  executingTaskId: string,
  relativePaths: string[],
): void {
  const targetTaskTypes = resolveDescriptionTargetTaskTypes(executingTaskType);
  if (targetTaskTypes.length === 0) return;

  const description = updateDescription4Task(
    parentTaskId,
    executingTaskType,
    executingTaskId,
    relativePaths,
  );
  if (!description) return;

  const tasks = listTasksByPid(db, parentTaskId);
  for (const targetTaskType of targetTaskTypes) {
    const row = tasks.find((t) => t.task_type === targetTaskType);
    if (!row) continue;
    updateTask(db, row.id, { description });
  }
}
