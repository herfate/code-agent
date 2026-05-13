import { z } from "zod";

/** HTTPS 克隆 Git 时作为 token 的 Basic 用户名（写入 `tasks.creator`）；必填 */
export const zTaskCreator = z
  .unknown()
  .transform((v) => (typeof v === "string" ? v.trim() : ""))
  .pipe(z.string().min(1, { message: "获取当前登录用户失败" }).max(200));
