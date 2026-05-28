import { Codex } from "@openai/codex-sdk";
import type { ThreadEvent } from "@openai/codex-sdk";
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

export type CodexSseOptions = {
  threadId: string;
  apiKey?: string;
  codexPathOverride?: string;
  prompt: string;
  model?: string;
  resumeThreadId?: string | null;
  clientSignal?: AbortSignal;
  runRecorder?: { db: DatabaseSync; runId: string };
};

function latestAgentText(events: ThreadEvent[]): string {
  let last = "";
  for (const ev of events) {
    if (ev.type === "item.completed" && ev.item.type === "agent_message") {
      last = ev.item.text;
    }
    if (ev.type === "item.updated" && ev.item.type === "agent_message") {
      last = ev.item.text;
    }
  }
  return last;
}

function safeSse(reply: FastifyReply, fn: () => void): void {
  if (reply.raw.writableEnded || reply.raw.destroyed) return;
  try {
    fn();
  } catch {
    /* client disconnected */
  }
}

function emitData(
  reply: FastifyReply,
  recorder: CodexSseOptions["runRecorder"],
  data: Record<string, unknown>,
): void {
  if (recorder) {
    const seq = appendAgentRunEvent(recorder.db, recorder.runId, "message", data);
    safeSse(reply, () => sendSseData(reply, { ...data, seq }));
  } else {
    safeSse(reply, () => sendSseData(reply, data));
  }
}

export async function streamCodexTurnToSse(
  reply: FastifyReply,
  opts: CodexSseOptions,
): Promise<{ codexThreadId: string | null; assistantText: string | null; error: string | null }> {
  const controller = new AbortController();
  const recorder = opts.runRecorder;
  if (!recorder) {
    attachAbortOnClose(reply, controller);
  }
  if (opts.clientSignal) {
    if (opts.clientSignal.aborted) controller.abort();
    else opts.clientSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  initSse(reply);
  if (recorder) {
    emitData(reply, recorder, {
      type: "meta",
      threadId: opts.threadId,
      provider: AGENT_PROVIDER.Codex,
      runId: recorder.runId,
    });
  } else {
    safeSse(reply, () =>
      sendSseData(reply, { type: "meta", threadId: opts.threadId, provider: AGENT_PROVIDER.Codex }),
    );
  }

  let codexThreadId: string | null = null;
  let assistantText: string | null = null;
  let error: string | null = null;
  const seen: ThreadEvent[] = [];

  try {
    const codex = new Codex({
      apiKey: opts.apiKey,
      codexPathOverride: opts.codexPathOverride,
    });

    const thread = opts.resumeThreadId
      ? codex.resumeThread(opts.resumeThreadId, {
          model: opts.model,
          workingDirectory: process.cwd(),
        })
      : codex.startThread({
          model: opts.model,
          workingDirectory: process.cwd(),
        });

    const { events } = await thread.runStreamed(opts.prompt, { signal: controller.signal });

    for await (const ev of events) {
      seen.push(ev);
      if (ev.type === "thread.started") {
        codexThreadId = ev.thread_id;
      }
      if (ev.type === "error") {
        error = ev.message;
      }
      if (ev.type === "turn.failed") {
        error = ev.error.message;
      }
      emitData(reply, recorder, { channel: "codex", payload: ev } as unknown as Record<string, unknown>);
    }

    assistantText = latestAgentText(seen) || null;

    const doneSeq = recorder ? appendAgentRunEvent(recorder.db, recorder.runId, "done", { ok: true }) : null;
    safeSse(reply, () => sendSseDone(reply, doneSeq != null ? { seq: doneSeq } : undefined));
    if (recorder) {
      finishAgentRun(recorder.db, recorder.runId, { status: "completed" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error = error ?? message;
    if (recorder) {
      appendAgentRunEvent(recorder.db, recorder.runId, "error", { message });
      safeSse(reply, () => sendSseError(reply, message));
      finishAgentRun(recorder.db, recorder.runId, { status: "failed", error_message: message });
      const doneSeq = appendAgentRunEvent(recorder.db, recorder.runId, "done", { ok: false });
      safeSse(reply, () => sendSseDone(reply, { ok: false, seq: doneSeq }));
    } else {
      safeSse(reply, () => sendSseError(reply, message));
    }
  } finally {
    try {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        endSse(reply);
      }
    } catch {
      /* already closed */
    }
  }

  return { codexThreadId, assistantText, error };
}
