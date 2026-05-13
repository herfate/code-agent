import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createAgentRun } from "../../db/agentRun.js";
import {
  createThread,
  getThread,
  insertMessage,
  updateThreadExternalId,
} from "../../db/repository.js";
import { parseTaskInputJson } from "../../db/taskInputJson.js";
import { TASK_STATUS, updateTask, type TaskRow } from "../../db/workflow.js";
import { AppLog } from "../appLogger.js";
import { streamClaudeQueryToSse } from "../agentsdk/claudeAgent.js";
import { prepareClaimedTaskRepoWorkspace } from "../tools/gitlabTool.js";
import { writeClaimedTaskPromptFile } from "../file/writeClaimedTaskPromptFile.js";
import { writeClaimedTaskOutTplFile } from "../file/writeClaimedTaskOutTplFile.js";
import { runParentTaskChangedFilesPipeline } from "./pipeline.js";
import { listTaskRepoFilesModifiedSince } from "../file/scanTaskRepoModifiedSince.js";
import { failClaimedTaskAfterRunStart } from "../scheduler/taskService.js";
import { mergeTaskMetaWithClaudeRunId } from "../taskClaudeMeta.js";
import type { ParentTaskRow } from "../../db/parentTask.js";
import { isToolTaskType, TASK_TYPE } from "../../constants/taskType.js";
import { handleTestEnvDeployToolTask } from "./toolTasks/testEnvDeployToolTask.js";


/**
 * Agent 任务：使用任务 `description` 作为提示词调用 Claude Agent SDK，结束后写回状态与出参。
 */
export async function handleClaimedAgentTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const log = AppLog.logger;
  const taskInputJson = parseTaskInputJson(task.input_json);
  // 步骤 1：从任务描述得到提示词，并准备写入 completed_at 等字段用的时间戳
  const prompt = task.description.trim();
  const t = () => Date.now();

  // 步骤 2：无有效提示词则直接失败，避免空跑 SDK
  if (!prompt) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "任务描述为空，无法执行 Agent",
    });
    log.warn({ taskId: task.id }, "claimed task: empty description");
    return;
  }

  // 开始进入 Agent 主流程（打结构化日志）
  log.info(
    {
      taskId: task.id,
      title: task.title,
      app: taskInputJson.app,
      branch_version: taskInputJson.branch_version,
    },
    "定时任务 running task",
  );

  // 步骤 3：确保存在与任务绑定的 Claude 会话（thread）；无则新建，坏引用或 provider 不符则失败或换新线程
  let threadId = task.thread_id;
  if (!threadId) {
    threadId = randomUUID();
    createThread(db, { id: threadId, provider: "claude", title: task.title || "Task agent" });
    updateTask(db, task.id, { thread_id: threadId });
  } else {
    const th = getThread(db, threadId);
    if (!th) {
      threadId = randomUUID();
      createThread(db, { id: threadId, provider: "claude", title: task.title || "Task agent" });
      updateTask(db, task.id, { thread_id: threadId });
    } else if (th.provider !== "claude") {
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: "任务关联的会话 provider 不是 claude",
      });
      log.error({ taskId: task.id, threadId }, "claimed task: thread provider mismatch");
      return;
    }
  }

  // 步骤 4：把本次用户提示写入 messages，与对话线程对齐
  insertMessage(db, {
    id: randomUUID(),
    thread_id: threadId,
    role: "user",
    content: prompt,
  });

  // 步骤 5：读取线程上的 SDK 会话 id，供 Claude Agent 断点续跑（resume）
  const threadRow = getThread(db, threadId)!;
  const resumeSessionId = threadRow.external_thread_id ?? undefined;

  // 步骤 6：为本轮执行创建 agent_run，用于 agent_run_events 落库与前端按 run 续订 SSE
  const runId = randomUUID();
  createAgentRun(db, { id: runId, thread_id: threadId, provider: "claude" });

  // 步骤 7：把 runId 写入任务 meta_json（claudeAgentRunId），便于 GET …/tasks/:id/claude-agent-stream 仅用任务 id 续订
  const metaJson = mergeTaskMetaWithClaudeRunId(task.meta_json, runId);
  updateTask(db, task.id, { meta_json: metaJson });

  // 步骤 7.1：准备任务工作目录，并 clone 仓库
  const taskRepoCwd = path.join(process.cwd(), "task-repo", parentTask.pid);
  const repoOk = await prepareClaimedTaskRepoWorkspace({
    db,
    taskInputJson,
    creator: task.creator,
    taskRepoCwd,
    taskId: parentTask.pid,
    onClonePrepFailed: (errorMessage) =>
      failClaimedTaskAfterRunStart({
        db,
        taskId: task.id,
        runId,
        errorMessage,
        logReason: "gitlab clone / prep",
        outputExtra: { cloneError: errorMessage },
        completedAt: t(),
      }),
  });
  if (!repoOk) return;


  // 步骤 7.2：description 写入 task_prompt.md；Agent 提示词为 init 模板（优先具体用户）
  const agentPrompt = writeClaimedTaskPromptFile(db, task, taskRepoCwd);

  // 步骤 7.3：查询 tpl_key=2（out_tpl），若有则写入任务仓库 task_out_tpl.txt
  writeClaimedTaskOutTplFile(db, task, taskRepoCwd);

  // 克隆与提示词写入完成后的基线时间戳（步骤 12.1 扫描 mtime 大于此值的文件）
  const repoScanSinceMs = Date.now() + 1500;

  // 步骤 8：无 HTTP 回复、仅落库模式跑agent
  const { sessionId, assistantText, sdkError } = await streamClaudeQueryToSse(null, {
    threadId,
    pId: parentTask.pid,
    prompt: agentPrompt,
    model: undefined,
    resume: resumeSessionId,
    runRecorder: { db, runId },
  });

  // 步骤 9：组装任务出参 JSON（成功/失败分支都会写入 output_json 便于排查）
  const outputPayload = {
    assistantText: assistantText ?? "",
    sessionId: sessionId ?? null,
    runId,
  };

  // 步骤 10：若本轮拿到新的 SDK session_id，回写到 threads.external_thread_id，下次同线程可 resume
  if (sessionId) {
    updateThreadExternalId(db, threadId, sessionId);
  }

  // 步骤 11：SDK 报错或 result 非成功——写 system 消息、任务失败、带 output_json 退出
  if (sdkError) {
    if (assistantText) {
      insertMessage(db, {
        id: randomUUID(),
        thread_id: threadId,
        role: "assistant",
        content: assistantText,
      });
    }
    insertMessage(db, {
      id: randomUUID(),
      thread_id: threadId,
      role: "system",
      content: `error: ${sdkError}`,
    });
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: sdkError,
      output_json: JSON.stringify(outputPayload),
    });
    log.error({ taskId: task.id, err: sdkError }, "claimed task: Claude agent error");
    return;
  }

  // 步骤 12：成功——若有AI响应正文则写入 messages
  if (assistantText) {
    insertMessage(db, {
      id: randomUUID(),
      thread_id: threadId,
      role: "assistant",
      content: assistantText,
    });
  }

  // 步骤 12.1：保存输出文件parent_task_params.changed_files/提交代码文件mr
  const changedFiles = listTaskRepoFilesModifiedSince(taskRepoCwd, repoScanSinceMs);
  await runParentTaskChangedFilesPipeline({
    db,
    parentTaskId: parentTask.pid,
    executingTaskId: task.id,
    taskType: task.task_type,
    taskRepoCwd,
    relativePaths: changedFiles,
    gitCtx: { taskInputJson, creator: task.creator },
  });
  log.info(
    { taskId: task.id, parentTaskId: parentTask.pid, changedFileCount: changedFiles.length },
    "claimed task: saved changed_files to parent_task_params",
  );

  // 步骤 13：任务标记完成并写入汇总出参
  updateTask(db, task.id, {
    status: TASK_STATUS.Completed,
    completed_at: t(),
    error_message: null,
    output_json: JSON.stringify(outputPayload),
  });
  log.info({ taskId: task.id, sessionId }, "claimed task: Claude agent finished");
}
