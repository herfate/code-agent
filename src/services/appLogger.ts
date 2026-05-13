import type { FastifyBaseLogger } from "fastify";

/**
 * 应用级全局日志：在 `server.ts` 创建 Fastify 实例后调用 {@link AppLog.init}，
 * 后台任务与无 `request` 上下文的模块统一通过 {@link AppLog.logger} 写结构化日志。
 */
export class AppLog {
  private static root: FastifyBaseLogger | null = null;

  static init(log: FastifyBaseLogger): void {
    AppLog.root = log;
  }

  static get logger(): FastifyBaseLogger {
    if (!AppLog.root) {
      throw new Error("AppLog.init(app.log) 须在创建 Fastify 实例后调用");
    }
    return AppLog.root;
  }
}
