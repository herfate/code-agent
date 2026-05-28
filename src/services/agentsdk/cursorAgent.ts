import { Agent, CursorAgentError } from "@cursor/sdk";
import type { ConversationStep, SDKAgent } from "@cursor/sdk";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDER } from "../../constants/agentProvider.js";
import type { FastifyReply } from "fastify";
import { appendAgentRunEvent, finishAgentRun } from "../../db/agentRun.js";
import {
  attachAbortOnClose,
  endSse,
  initSse,
  sendSseData,
  sendSseDone,
  sendSseError,
} from "../../sse/helpers.js";

const DEFAULT_MODEL = "composer-2.5";

/** 将 onStep 的 ConversationStep 转为前端可渲染的 payload（按步骤，非 token 级） */
function summarizeCursorStep(
  step: ConversationStep,
  runId: string,
  agentId: string,
): Record<string, unknown> {
  if (step.type === "assistantMessage") {
    return {
      type: "assistant",
      agent_id: agentId,
      run_id: runId,
      message: {
        role: "assistant",
        content: [{ type: "text", text: step.message.text }],
      },
    };
  }
  if (step.type === "thinkingMessage") {
    return {
      type: "thinking",
      agent_id: agentId,
      run_id: runId,
      text: step.message.text,
      thinking_duration_ms: step.message.thinkingDurationMs,
    };
  }
  if (step.type === "toolCall") {
    const tool = step.message;
    return {
      type: "tool_call",
      agent_id: agentId,
      run_id: runId,
      name: tool.type,
      status: "completed",
      args: "args" in tool ? tool.args : undefined,
      result: "result" in tool ? tool.result : undefined,
    };
  }
  return { type: "step", agent_id: agentId, run_id: runId, step };
}

function resolveAgentCwd(pId: string): string {
  if (pId === "demo") return process.cwd();
  return path.join(process.cwd(), "task-repo", pId);
}

export type CursorSseOptions = {
  threadId: string;
  pId: string;
  prompt: string;
  apiKey: string;
  model?: string;
  /** threads.external_thread_id 中存的 Cursor agentId */
  resume?: string;
  /** 首轮成功后同一 agent 再 send 一轮（如认领任务 12.1 前补输出） */
  followUpPrompt?: string;
  clientSignal?: AbortSignal;
  runRecorder?: { db: DatabaseSync; runId: string };
};

function safeSse(reply: FastifyReply | null, fn: (r: FastifyReply) => void): void {
  if (!reply || reply.raw.writableEnded || reply.raw.destroyed) return;
  try {
    fn(reply);
  } catch {
    /* client disconnected */
  }
}

function emitData(
  reply: FastifyReply | null,
  recorder: CursorSseOptions["runRecorder"],
  data: Record<string, unknown>,
): void {
  if (recorder) {
    const seq = appendAgentRunEvent(recorder.db, recorder.runId, "message", data);
    safeSse(reply, (r) => sendSseData(r, { ...data, seq }));
  } else {
    safeSse(reply, (r) => sendSseData(r, data));
  }
}

async function disposeAgent(agent: SDKAgent | null): Promise<void> {
  if (!agent) return;
  try {
    await agent[Symbol.asyncDispose]();
  } catch {
    /* ignore */
  }
}

type RoundResult = { assistantText: string | null; sdkError: string | null };

async function runSendRound(
  agent: SDKAgent,
  prompt: string,
  reply: FastifyReply | null,
  recorder: CursorSseOptions["runRecorder"],
  abortSignal: AbortSignal,
): Promise<RoundResult> {
  let assistantText: string | null = null;
  let sdkError: string | null = null;

  let cancelled = false;
  const runHolder = { id: "" };

  const run = await agent.send(prompt, {
    onStep: async ({ step }) => {
      emitData(reply, recorder, {
        channel: "cursor",
        payload: summarizeCursorStep(step, runHolder.id, agent.agentId),
      });
    },
  });
  runHolder.id = run.id;

  const onAbort = () => {
    cancelled = true;
    if (run.supports("cancel")) {
      void run.cancel().catch(() => {
        /* ignore */
      });
    }
  };
  if (abortSignal.aborted) onAbort();
  else abortSignal.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await run.wait();
    if (result.status === "finished") {
      assistantText = result.result ?? null;
    } else if (result.status === "error") {
      sdkError = `run ${result.id} failed`;
    } else if (result.status === "cancelled") {
      sdkError = cancelled ? "cancelled" : `run ${result.id} cancelled`;
    }
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
  }

  return { assistantText, sdkError };
}

/**
 * @param reply 浏览器 SSE 时传入；定时任务等仅落库续订场景传 `null`（须带 `runRecorder`）。
 */
export async function streamCursorQueryToSse(
  reply: FastifyReply | null,
  opts: CursorSseOptions,
): Promise<{ agentId: string | null; assistantText: string | null; sdkError: string | null }> {
  const controller = new AbortController();
  const recorder = opts.runRecorder;
  if (!recorder && !reply) {
    throw new Error("streamCursorQueryToSse: reply is required when runRecorder is omitted");
  }
  if (!recorder && reply) {
    attachAbortOnClose(reply, controller);
  }
  if (opts.clientSignal) {
    if (opts.clientSignal.aborted) controller.abort();
    else opts.clientSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  if (reply) initSse(reply);
  if (recorder) {
    emitData(reply, recorder, {
      type: "meta",
      threadId: opts.threadId,
      provider: AGENT_PROVIDER.Cursor,
      runId: recorder.runId,
    });
  } else {
    safeSse(reply, (r) =>
      sendSseData(r, { type: "meta", threadId: opts.threadId, provider: AGENT_PROVIDER.Cursor }),
    );
  }

  const cwd = resolveAgentCwd(opts.pId);
  const modelId = opts.model?.trim() || DEFAULT_MODEL;
  const agentOpts = {
    apiKey: opts.apiKey,
    model: { id: modelId },
    local: { cwd, settingSources: [] },
  };

  let agent: SDKAgent | null = null;
  let agentId: string | null = null;
  let assistantText: string | null = null;
  let sdkError: string | null = null;

  try {
    agent = opts.resume
      ? await Agent.resume(opts.resume, agentOpts)
      : await Agent.create(agentOpts);
    agentId = agent.agentId;

    const first = await runSendRound(agent, opts.prompt, reply, recorder, controller.signal);
    assistantText = first.assistantText;
    sdkError = first.sdkError;

    if (!sdkError && opts.followUpPrompt?.trim()) {
      const follow = await runSendRound(agent, opts.followUpPrompt.trim(), reply, recorder, controller.signal);
      if (follow.assistantText) {
        assistantText = [assistantText, follow.assistantText].filter(Boolean).join("\n\n");
      }
      sdkError = follow.sdkError;
    }

    const doneSeq = recorder ? appendAgentRunEvent(recorder.db, recorder.runId, "done", { ok: true }) : null;
    safeSse(reply, (r) => sendSseDone(r, doneSeq != null ? { seq: doneSeq } : undefined));
    if (recorder) {
      finishAgentRun(recorder.db, recorder.runId, { status: "completed" });
    }
  } catch (err) {
    const message =
      err instanceof CursorAgentError
        ? `startup failed: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    sdkError = sdkError ?? message;
    if (recorder) {
      appendAgentRunEvent(recorder.db, recorder.runId, "error", { message });
      safeSse(reply, (r) => sendSseError(r, message));
      finishAgentRun(recorder.db, recorder.runId, { status: "failed", error_message: message });
      const doneSeq = appendAgentRunEvent(recorder.db, recorder.runId, "done", { ok: false });
      safeSse(reply, (r) => sendSseDone(r, { ok: false, seq: doneSeq }));
    } else {
      safeSse(reply, (r) => sendSseError(r, message));
    }
  } finally {
    await disposeAgent(agent);
    try {
      if (reply && !reply.raw.writableEnded && !reply.raw.destroyed) {
        endSse(reply);
      }
    } catch {
      /* already closed */
    }
  }

  return { agentId, assistantText, sdkError };
}
