import type { FastifyReply } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { getAgentRun, listAgentRunEventsAfter } from "../db/agentRun.js";
import { endSse, initSse, sendSseData, sendSseDone, sendSseError } from "./helpers.js";

const POLL_MS = 120;

function wirePayload(row: { seq: number; payload_json: string }): Record<string, unknown> {
  const parsed: unknown = JSON.parse(row.payload_json);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return { ...(parsed as Record<string, unknown>), seq: row.seq };
  }
  return { _body: parsed, seq: row.seq };
}

/**
 * GET SSE: replay persisted events for a run, then poll while status is `running`
 * (same process as the POST stream — survives tab close on the server until completion).
 */
export async function pipeAgentRunReplayToSse(
  reply: FastifyReply,
  db: DatabaseSync,
  runId: string,
  afterSeq: number,
): Promise<void> {
  const run = getAgentRun(db, runId);
  if (!run) {
    return reply.status(404).send({ error: "run not found" });
  }

  reply.hijack();
  initSse(reply);

  let last = afterSeq;

  try {
    for (;;) {
      let batch = listAgentRunEventsAfter(db, runId, last, 500);
      while (batch.length > 0) {
        for (const row of batch) {
          last = row.seq;
          const wire = wirePayload(row);
          if (row.event_name === "message") {
            sendSseData(reply, wire);
          } else if (row.event_name === "done") {
            sendSseDone(reply, wire);
          } else {
            const msg =
              typeof wire.message === "string"
                ? wire.message
                : typeof wire.message === "number"
                  ? String(wire.message)
                  : "error";
            sendSseError(reply, msg, wire);
          }
        }
        batch = listAgentRunEventsAfter(db, runId, last, 500);
      }

      const r = getAgentRun(db, runId);
      if (!r || r.status !== "running") break;

      await new Promise((res) => setTimeout(res, POLL_MS));
    }
  } catch (err) {
    try {
      const message = err instanceof Error ? err.message : String(err);
      sendSseError(reply, message);
    } catch {
      /* reply gone */
    }
  } finally {
    try {
      endSse(reply);
    } catch {
      /* already closed */
    }
  }
}
