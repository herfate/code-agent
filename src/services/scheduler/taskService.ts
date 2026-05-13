import type { DatabaseSync } from "node:sqlite";
import { finishAgentRun } from "../../db/agentRun.js";
import { TASK_STATUS, updateTask } from "../../db/workflow.js";
import { AppLog } from "../appLogger.js";

/** 认领任务已创建 `agent_run` 后，前置失败时统一写库（不写 messages） */
export type FailClaimedTaskAfterRunStartInput = {
  db: DatabaseSync;
  taskId: string;
  runId: string;
  errorMessage: string;
  /** 日志文案片段，如 `gitlab clone / prep` */
  logReason: string;
  /** 合并进 `output_json` */
  outputExtra?: Record<string, unknown>;
  /** 默认 `Date.now()`，与认领流程其它字段对齐时可传入同一时钟函数返回值 */
  completedAt?: number;
};

export function failClaimedTaskAfterRunStart(input: FailClaimedTaskAfterRunStartInput): void {
  const { db, taskId, runId, errorMessage, logReason, outputExtra, completedAt } = input;
  finishAgentRun(db, runId, { status: "failed", error_message: errorMessage });
  updateTask(db, taskId, {
    status: TASK_STATUS.Failed,
    completed_at: completedAt ?? Date.now(),
    error_message: errorMessage,
    output_json: JSON.stringify({
      assistantText: "",
      sessionId: null,
      runId,
      ...outputExtra,
    }),
  });
  AppLog.logger.error({ taskId, err: errorMessage }, `claimed task: ${logReason}`);
}
