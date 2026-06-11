import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { TASK_RUN_AGENT_PROVIDER } from "../../constants/agentProvider.js";
import { loadConfig } from "../../config.js";
import { createAgentRun } from "../../db/agentRun.js";
import {
  createThread,
  getThread,
  insertMessage,
  updateThreadExternalId,
  type Provider,
} from "../../db/repository.js";
import { parseTaskInputJson } from "../../db/taskInputJson.js";
import { addTaskCost, TASK_STATUS, updateTask, type TaskRow } from "../../db/workflow.js";
import { AppLog } from "../appLogger.js";
import { streamClaudeQueryToSse } from "../agentsdk/claudeAgent.js";
import { streamCursorQueryToSse } from "../agentsdk/cursorAgent.js";
import { prepareClaimedTaskRepoWorkspace } from "../tools/gitlabTool.js";
import { writeClaimedTaskPromptFile } from "../file/writeClaimedTaskPromptFile.js";
import { writeClaimedTaskOutTplFile } from "../file/writeClaimedTaskOutTplFile.js";
import { resolveClaimedTaskRepoWorkspace } from "../file/taskRepoWorkspace.js";
import { runParentTaskChangedFilesPipeline } from "./pipeline.js";
import { listTaskRepoFilesModifiedSince } from "../file/scanTaskRepoModifiedSince.js";
import { failClaimedTaskAfterRunStart } from "../scheduler/taskService.js";
import {
  mergeTaskMetaWithAgentRunId,
  mergeTaskMetaWithTaskRepoWorkspaceId,
  type TaskAgentProvider,
} from "../taskAgentMeta.js";
import { resolveParentTaskAgentProvider, type ParentTaskRow } from "../../db/parentTask.js";
import { buildClaimedTaskFollowUpPrompt } from "../prompt/buildClaimedTaskFollowUpPrompt.js";
import { switchClaudeSettingsForTaskFromDbAsync } from "../claude/updateClaudeJsonAuthToken.js";
import { isCancelledErrorMessage } from "../scheduler/claimedTaskRetry.js";

type AgentRunOutcome = {
  externalId: string | null;
  assistantText: string | null;
  sdkError: string | null;
};

/**
 * Agent 任务：按 `TASK_AGENT_PROVIDER` 调用 Claude 或 Cursor Agent SDK，结束后写回状态与出参。
 */
export async function handleClaimedAgentTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const segmentStart = Date.now();
  try {
    await runClaimedAgentTask(db, task, parentTask);
  } finally {
    addTaskCost(db, task.id, Date.now() - segmentStart);
  }
}

async function runClaimedAgentTask(
  db: DatabaseSync,
  task: TaskRow,
  parentTask: ParentTaskRow,
): Promise<void> {
  const log = AppLog.logger;
  const config = loadConfig();
  const agentProvider: TaskAgentProvider = resolveParentTaskAgentProvider(
    db,
    parentTask.pid,
    config.TASK_AGENT_PROVIDER,
    task.task_type,
  );
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

  if (agentProvider === TASK_RUN_AGENT_PROVIDER.Cursor && !config.CURSOR_API_KEY) {
    updateTask(db, task.id, {
      status: TASK_STATUS.Failed,
      completed_at: t(),
      error_message: "CURSOR_API_KEY 未配置，无法执行 Cursor Agent 任务",
    });
    log.error({ taskId: task.id }, "claimed task: CURSOR_API_KEY missing");
    return;
  }

  log.info(
    {
      taskId: task.id,
      title: task.title,
      app: taskInputJson.app,
      gitRepos: taskInputJson.gitRepos,
      agentProvider,
    },
    "定时任务 running task",
  );

  // 步骤 3：确保存在与任务绑定的 Claude 会话（thread）；无则新建，坏引用或 provider 不符则失败或换新线程
  let threadId = task.thread_id;
  if (!threadId) {
    threadId = randomUUID();
    createThread(db, { id: threadId, provider: agentProvider, title: task.title || "Task agent" });
    updateTask(db, task.id, { thread_id: threadId });
  } else {
    const th = getThread(db, threadId);
    if (!th) {
      threadId = randomUUID();
      createThread(db, { id: threadId, provider: agentProvider, title: task.title || "Task agent" });
      updateTask(db, task.id, { thread_id: threadId });
    } else if (th.provider !== agentProvider) {
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: `任务关联的会话 provider 不是 ${agentProvider}`,
      });
      log.error({ taskId: task.id, threadId, provider: th.provider }, "claimed task: thread provider mismatch");
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
  const resumeExternalId = threadRow.external_thread_id ?? undefined;

  // 步骤 6：为本轮执行创建 agent_run，用于 agent_run_events 落库与前端按 run 续订 SSE
  const runId = randomUUID();
  createAgentRun(db, { id: runId, thread_id: threadId, provider: agentProvider as Provider });

  // 步骤 7：解析工作区路径 task-repo/<pid>_<uuid>/，并把 runId、workspaceId 写入 meta_json
  const { workspaceId, reuseExisting, taskRepoDirName, taskRepoCwd } = resolveClaimedTaskRepoWorkspace(
    task,
    parentTask.pid,
  );
  let nextMetaJson = task.meta_json;
  if (!reuseExisting) {
    nextMetaJson = mergeTaskMetaWithTaskRepoWorkspaceId(nextMetaJson, workspaceId);
  }
  const metaJson = mergeTaskMetaWithAgentRunId(nextMetaJson, agentProvider, runId);
  updateTask(db, task.id, { meta_json: metaJson });

  // 步骤 7.1：准备任务工作目录，并 clone 仓库（续跑时复用已有目录）
  const repoOk = await prepareClaimedTaskRepoWorkspace({
    db,
    taskInputJson,
    creator: task.creator,
    taskRepoCwd,
    taskId: parentTask.pid,
    taskType: task.task_type,
    reuseExisting,
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
  const followUpPrompt = buildClaimedTaskFollowUpPrompt(db, task);

  // 步骤 8：无 HTTP 回复、仅落库模式跑agent
  let outcome: AgentRunOutcome;
  if (agentProvider === TASK_RUN_AGENT_PROVIDER.Cursor) {
    const { agentId, assistantText, sdkError } = await streamCursorQueryToSse(null, {
      threadId,
      pId: taskRepoDirName,
      prompt: agentPrompt,
      apiKey: config.CURSOR_API_KEY!,
      model: undefined,
      taskType: task.task_type,
      resume: resumeExternalId,
      followUpPrompt,
      runRecorder: { db, runId },
    });
    outcome = { externalId: agentId, assistantText, sdkError };
  } else {
    // claude：切换账号并写入 settings（含 TAPD custom headers；tick 内并行时通过写入锁串行化）
    await switchClaudeSettingsForTaskFromDbAsync(
      db,
      taskRepoCwd,
      task.creator,
      taskInputJson.tapdTaskId ?? "",
      log,
    );
    const { sessionId, assistantText, sdkError } = await streamClaudeQueryToSse(null, {
      threadId,
      pId: taskRepoDirName,
      prompt: agentPrompt,
      model: undefined,
      resume: resumeExternalId,
      followUpPrompt,
      runRecorder: { db, runId },
    });
    outcome = { externalId: sessionId, assistantText, sdkError };
  }

  // 步骤 9：组装任务出参 JSON（成功/失败分支都会写入 output_json 便于排查）
  const outputPayload = {
    assistantText: outcome.assistantText ?? "",
    sessionId: outcome.externalId ?? null,
    agentProvider,
    runId,
  };

  // 步骤 10：若本轮拿到新的 SDK session_id，回写到 threads.external_thread_id，下次同线程可 resume
  if (outcome.externalId) {
    updateThreadExternalId(db, threadId, outcome.externalId);
  }

  // 步骤 11：SDK 报错或 result 非成功
  if (outcome.sdkError) {
    if (isCancelledErrorMessage(outcome.sdkError)) {
      if (outcome.assistantText) {
        insertMessage(db, {
          id: randomUUID(),
          thread_id: threadId,
          role: "assistant",
          content: outcome.assistantText,
        });
      }
      insertMessage(db, {
        id: randomUUID(),
        thread_id: threadId,
        role: "system",
        content: `error: ${outcome.sdkError}`,
      });
      updateTask(db, task.id, {
        status: TASK_STATUS.Failed,
        completed_at: t(),
        error_message: outcome.sdkError,
        output_json: JSON.stringify(outputPayload),
      });
      log.error({ taskId: task.id, err: outcome.sdkError, agentProvider }, "claimed task: agent cancelled");
      return;
    }
    // 非 cancelled 的 SDK 错误抛出让调度器重试；任务保持 running，不写失败态
    throw new Error(outcome.sdkError);
  }

  // 步骤 12：成功——若有AI响应正文则写入 messages
  if (outcome.assistantText) {
    insertMessage(db, {
      id: randomUUID(),
      thread_id: threadId,
      role: "assistant",
      content: outcome.assistantText,
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
  log.info({ taskId: task.id, externalId: outcome.externalId, agentProvider }, "claimed task: agent finished");
}
