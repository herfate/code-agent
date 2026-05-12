import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FastifyReply } from "fastify";
import {
  attachAbortOnClose,
  endSse,
  initSse,
  sendSseData,
  sendSseDone,
  sendSseError,
} from "../sse/helpers.js";

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
  /** App thread id (SQLite) — emitted as first SSE meta for clients */
  threadId: string;
  prompt: string;
  model?: string;
  /** Claude Code session UUID to resume */
  resume?: string;
  /** Optional caller-owned abort (e.g. upstream timeout) */
  clientSignal?: AbortSignal;
};

export async function streamClaudeQueryToSse(
  reply: FastifyReply,
  opts: ClaudeSseOptions,
): Promise<{ sessionId: string | null; assistantText: string | null; sdkError: string | null }> {
  const controller = new AbortController();
  attachAbortOnClose(reply, controller);
  if (opts.clientSignal) {
    if (opts.clientSignal.aborted) controller.abort();
    else opts.clientSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  initSse(reply);
  sendSseData(reply, { type: "meta", threadId: opts.threadId, provider: "claude" });

  let sessionId: string | null = null;
  let assistantText: string | null = null;
  let sdkError: string | null = null;

  try {
    const q = query({
      prompt: opts.prompt,
      options: {
        abortController: controller,
        model: opts.model,
        resume: opts.resume,
        cwd: process.cwd(),
        canUseTool: async () => ({ behavior: "allow" as const }),
      },
    });

    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
      }
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          assistantText = msg.result;
        } else {
          sdkError = msg.errors?.join("; ") ?? msg.subtype;
        }
      }
      sendSseData(reply, { channel: "claude", payload: summarizeSdkMessage(msg) });
    }
    sendSseDone(reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sdkError = sdkError ?? message;
    sendSseError(reply, message);
  } finally {
    endSse(reply);
  }

  return { sessionId, assistantText, sdkError };
}
