import fs from "node:fs";
import path from "node:path";

/** 与 SQLite 同目录下的 access.log */
let logPath: string | null = null;

/** 根据 DATABASE_PATH 初始化访问日志文件路径 */
export function initAccessLog(databasePath: string): void {
  logPath = path.join(path.dirname(path.resolve(databasePath)), "access.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
}

/** 从请求头或 Cookie 读取 localStorage 同步过来的 userName */
export function readAccessUserName(
  headers: Record<string, string | string[] | undefined>,
): string {
  const fromHeader = headers["x-user-name"];
  if (typeof fromHeader === "string" && fromHeader.trim()) {
    return sanitizeLogField(fromHeader.trim());
  }
  const cookie = headers.cookie;
  if (typeof cookie === "string") {
    const m = cookie.match(/(?:^|;\s*)userName=([^;]*)/);
    if (m?.[1]) {
      try {
        return sanitizeLogField(decodeURIComponent(m[1].trim()));
      } catch {
        return sanitizeLogField(m[1].trim());
      }
    }
  }
  return "-";
}

function sanitizeLogField(value: string): string {
  return value.replace(/[\t\r\n]/g, " ");
}

/** 追加一行访问记录（异步写入，不阻塞响应）；跳过 js/css 静态资源 */
export function writeAccessLog(fields: {
  ip: string;
  userName: string;
  method: string;
  url: string;
  statusCode: number;
  responseTimeMs: number;
}): void {
  if (!logPath) return;
  const pathOnly = fields.url.split("?")[0]?.split("#")[0] ?? fields.url;
  if (/\.(?:js|css)$/i.test(pathOnly)) return;
  const line =
    [
      new Date().toISOString(),
      fields.ip,
      fields.userName,
      fields.method,
      fields.url,
      String(fields.statusCode),
      `${fields.responseTimeMs.toFixed(1)}ms`,
    ].join("\t") + "\n";
  fs.appendFile(logPath, line, () => {});
}
