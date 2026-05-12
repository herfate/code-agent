import type { FastifyReply } from "fastify";

export type SsePayload = Record<string, unknown>;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

function formatSseData(data: unknown): string {
  const line = typeof data === "string" ? data : JSON.stringify(data);
  return `data: ${line.replace(/\r\n|\r|\n/g, "\ndata: ")}\n\n`;
}

export function initSse(reply: FastifyReply): void {
  reply.raw.writeHead(200, { ...SSE_HEADERS });
  reply.raw.write(`retry: 3000\n\n`);
}

export function sendSseEvent(reply: FastifyReply, event: string, payload: SsePayload): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(formatSseData(payload));
}

export function sendSseData(reply: FastifyReply, payload: SsePayload): void {
  reply.raw.write(formatSseData(payload));
}

export function sendSseDone(reply: FastifyReply, extra?: Record<string, unknown>): void {
  sendSseEvent(reply, "done", { ok: true, ...(extra ?? {}) });
}

export function sendSseError(reply: FastifyReply, message: string, extra?: Record<string, unknown>): void {
  sendSseEvent(reply, "error", { message, ...extra });
}

export function endSse(reply: FastifyReply): void {
  reply.raw.end();
}

export function attachAbortOnClose(reply: FastifyReply, controller: AbortController): void {
  reply.raw.on("close", () => {
    controller.abort();
  });
}
