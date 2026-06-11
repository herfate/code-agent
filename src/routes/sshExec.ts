import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  buildSshConnectOptionsFromEnv,
  readSshExecTimeoutFromEnv,
  runSshRemoteCommand,
} from "../services/tools/sshClient.js";

function ok<T>(data: T) {
  return { code: 200 as const, message: "success", data };
}

function err(code: number, message: string) {
  return { code, message };
}

const sshExecBody = z.object({
  /** 远程 shell 命令 */
  command: z.string().min(1).max(8192),
  /** 等待输出超时（毫秒）；默认读 `SSH_COMMAND_TIMEOUT_MS` 或 60000 */
  timeoutMs: z.coerce.number().int().min(1000).max(600_000).optional(),
  /** 覆盖 `.env` 中的穿透目标 IP */
  targetHost: z.string().min(1).max(255).optional(),
  /** 覆盖 `.env` 中的穿透目标账号 */
  targetUser: z.string().min(1).max(128).optional(),
  /** 设为 false 时不穿透，仅连堡垒机 */
  usePierce: z.boolean().optional(),
});

/**
 * SSH 远程命令：堡垒机凭据来自 `.env`（`SSH_HOST` 等），
 * 可选请求体覆盖穿透目标与超时。
 */
export function registerSshExecRoutes(app: FastifyInstance): void {
  app.post("/api/ssh/exec", async (request, reply) => {
    const parsed = sshExecBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(err(400, parsed.error.message));
    }

    let connectOptions;
    try {
      connectOptions = buildSshConnectOptionsFromEnv({
        targetHost: parsed.data.targetHost,
        targetUser: parsed.data.targetUser,
        usePierce: parsed.data.usePierce,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(503).send(err(503, msg));
    }

    const timeoutMs =
      parsed.data.timeoutMs ?? readSshExecTimeoutFromEnv() ?? DEFAULT_EXEC_TIMEOUT_MS;

    try {
      const result = await runSshRemoteCommand(connectOptions, parsed.data.command, {
        timeoutMs,
      });
      return ok({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        bastion: {
          host: connectOptions.host,
          port: connectOptions.port ?? 22,
        },
        target: connectOptions.bastionTarget ?? null,
        timeoutMs,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.error({ err: e, commandLen: parsed.data.command.length }, "ssh exec");
      return reply.status(500).send(err(500, msg));
    }
  });
}
