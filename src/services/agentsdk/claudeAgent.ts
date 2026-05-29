import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
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

function summarizeSdkMessage(msg: SDKMessage): Record<string, unknown> {
  if (msg.type === "assistant" || msg.type === "user") {
    return { type: msg.type, message: msg };
  }
  if (msg.type === "result") {
    return {
      type: "result",
      subtype: msg.subtype,
      is_error: msg.is_error,
      result: msg.subtype === "success" ? msg.result : undefined,
      errors: msg.subtype !== "success" ? msg.errors : undefined,
    };
  }
  if (msg.type === "system" && msg.subtype === "init") {
    return {
      type: "system",
      subtype: "init",
      session_id: msg.session_id,
      model: msg.model,
      cwd: msg.cwd,
    };
  }
  return { type: msg.type, message: msg };
}

export type ClaudeSseOptions = {
  threadId: string;
  pId: string;
  prompt: string;
  model?: string;
  resume?: string;
  /** 首轮成功后同 session 再跑一轮（如认领任务 12.1 前补输出） */
  followUpPrompt?: string;
  clientSignal?: AbortSignal;
  /** Persist each frame + keep SDK running after the browser disconnects (resume via GET …/runs/:id/stream). */
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
  recorder: ClaudeSseOptions["runRecorder"],
  data: Record<string, unknown>,
): void {
  if (recorder) {
    const seq = appendAgentRunEvent(recorder.db, recorder.runId, "message", data);
    safeSse(reply, (r) => sendSseData(r, { ...data, seq }));
  } else {
    safeSse(reply, (r) => sendSseData(r, data));
  }
}

/**
 * @param reply 浏览器 SSE 时传入；定时任务等仅落库续订场景传 `null`（须带 `runRecorder`）。
 */
export async function streamClaudeQueryToSse(
  reply: FastifyReply | null,
  opts: ClaudeSseOptions,
): Promise<{ sessionId: string | null; assistantText: string | null; sdkError: string | null }> {
  const controller = new AbortController();
  const recorder = opts.runRecorder;
  if (!recorder && !reply) {
    throw new Error("streamClaudeQueryToSse: reply is required when runRecorder is omitted");
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
      provider: AGENT_PROVIDER.Claude,
      runId: recorder.runId,
    });
  } else {
    safeSse(reply, (r) =>
      sendSseData(r, { type: "meta", threadId: opts.threadId, provider: AGENT_PROVIDER.Claude }),
    );
  }

  let sessionId: string | null = null;
  let assistantText: string | null = null;
  let sdkError: string | null = null;

  const taskRepoCwd = path.join(process.cwd(), "task-repo", opts.pId);
  mkdirSync(taskRepoCwd, { recursive: true });
  const runRound = async (prompt: string, resume?: string) => {
    let roundSessionId: string | null = null;
    let roundText: string | null = null;
    let roundError: string | null = null;
    const q = query({
      prompt,
      options: {
        abortController: controller,
        model: opts.model,
        resume,
        cwd: taskRepoCwd,
        canUseTool: async () => ({ behavior: "allow" as const }),
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    });
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") roundSessionId = msg.session_id;
      if (msg.type === "result") {
        if (msg.subtype === "success") roundText = msg.result;
        else {
          console.log("Claude error1:", msg.errors);
          roundError = msg.errors?.join("; ") ?? msg.subtype;
        }
      }
      emitData(reply, recorder, { channel: "claude", payload: summarizeSdkMessage(msg) });
    }
    return { sessionId: roundSessionId, assistantText: roundText, sdkError: roundError };
  };

  try {
    const first = await runRound(opts.prompt, opts.resume);
    sessionId = first.sessionId;
    assistantText = first.assistantText;
    sdkError = first.sdkError;
    if (!sdkError && opts.followUpPrompt?.trim()) {
      const follow = await runRound(opts.followUpPrompt.trim(), sessionId ?? undefined);
      if (follow.sessionId) sessionId = follow.sessionId;
      if (follow.assistantText) assistantText = [assistantText, follow.assistantText].filter(Boolean).join("\n\n");
      sdkError = follow.sdkError;
    }

    const doneSeq = recorder ? appendAgentRunEvent(recorder.db, recorder.runId, "done", { ok: true }) : null;
    safeSse(reply, (r) => sendSseDone(r, doneSeq != null ? { seq: doneSeq } : undefined));
    if (recorder) {
      finishAgentRun(recorder.db, recorder.runId, { status: "completed" });
    }
  } catch (err) {
    console.log("Claude error2:", err)
    const message = err instanceof Error ? err.message : String(err);
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
    console.log("Claude stream end")
    console.log("task completed:", opts.pId,  opts.prompt)
    try {
      if (reply && !reply.raw.writableEnded && !reply.raw.destroyed) {
        endSse(reply);
      }
    } catch {
      /* already closed */
    }
  }

  return { sessionId, assistantText, sdkError };
}
