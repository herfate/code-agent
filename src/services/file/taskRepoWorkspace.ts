import { randomUUID } from "node:crypto";
import type { TaskRow } from "../../db/workflow.js";
import { getTaskRepoWorkspaceIdFromTaskMeta } from "../taskAgentMeta.js";
import { hasFollowUpMessagesInTaskMeta } from "../taskFollowUpPrompt.js";
import { buildClaimedTaskRepoDirName, resolveTaskRepoCwd } from "./aiOutTaskPath.js";

export type ClaimedTaskRepoWorkspaceResolution = {
  workspaceId: string;
  /** 续跑：复用已有目录，跳过 wipe/clone */
  reuseExisting: boolean;
  taskRepoDirName: string;
  taskRepoCwd: string;
};

/** 认领任务时解析工作区 uuid：续跑 / 复制节点复用 meta 中 id，否则新生成 */
export function resolveClaimedTaskRepoWorkspace(
  task: TaskRow,
  parentTaskId: string,
): ClaimedTaskRepoWorkspaceResolution {
  const existingWorkspaceId = getTaskRepoWorkspaceIdFromTaskMeta(task.meta_json);
  // 复制节点保留 thread_id 以便续跑 Claude 会话；会话绑定 cwd，须复用同一 task-repo 目录
  const reuseExistingWorkspace =
    Boolean(existingWorkspaceId) &&
    (hasFollowUpMessagesInTaskMeta(task.meta_json) || Boolean(task.thread_id));
  if (reuseExistingWorkspace && existingWorkspaceId) {
    const taskRepoDirName = buildClaimedTaskRepoDirName(parentTaskId, existingWorkspaceId);
    return {
      workspaceId: existingWorkspaceId,
      reuseExisting: true,
      taskRepoDirName,
      taskRepoCwd: resolveTaskRepoCwd(taskRepoDirName),
    };
  }
  const workspaceId = randomUUID();
  const taskRepoDirName = buildClaimedTaskRepoDirName(parentTaskId, workspaceId);
  return {
    workspaceId,
    reuseExisting: false,
    taskRepoDirName,
    taskRepoCwd: resolveTaskRepoCwd(taskRepoDirName),
  };
}
