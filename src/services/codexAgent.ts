import { Codex } from "@openai/codex-sdk";
import type { ThreadEvent } from "@openai/codex-sdk";
import type { FastifyReply } from "fastify";
import {
  attachAbortOnClose,
  endSse,
  initSse,
  sendSseData,
  sendSseDone,
  sendSseError,
} from "../sse/helpers.js";

export type CodexSseOptions = {
  /** App thread id (SQLite) — emitted as first SSE meta for clients */
  threadId: string;
  apiKey?: string;
  /** Path to codex executable when not discoverable on PATH */
  codexPathOverride?: string;
  prompt: string;
  model?: string;
  /** Codex thread id from prior `thread.started` */
  resumeThreadId?: string | null;
  clientSignal?: AbortSignal;
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

export async function streamCodexTurnToSse(
  reply: FastifyReply,
  opts: CodexSseOptions,
): Promise<{ codexThreadId: string | null; assistantText: string | null; error: string | null }> {
  const controller = new AbortController();
  attachAbortOnClose(reply, controller);
  if (opts.clientSignal) {
    if (opts.clientSignal.aborted) controller.abort();
    else opts.clientSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  initSse(reply);
  sendSseData(reply, { type: "meta", threadId: opts.threadId, provider: "codex" });

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
      sendSseData(reply, { channel: "codex", payload: ev });
    }

    assistantText = latestAgentText(seen) || null;
    sendSseDone(reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error = error ?? message;
    sendSseError(reply, message);
  } finally {
    endSse(reply);
  }

  return { codexThreadId, assistantText, error };
}
