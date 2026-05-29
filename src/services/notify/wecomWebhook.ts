import { AppLog } from "../appLogger.js";

/** 默认企业微信机器人 Webhook（与 Java {@code NewTaskSchedulerService.HOOK_PATH} 一致） */
export const DEFAULT_WECOM_WEBHOOK_URL =
  "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=4a35b9cb-b4cc-4ee8-993e-b360f882a1e3";

export type SendWecomTextWebhookOptions = {
  hookUrl?: string;
};

/**
 * 发送企业微信文本 Webhook 消息（msgtype=text）。
 * 失败仅记日志，不抛出，避免影响主流程。
 */
export async function sendWecomTextWebhook(
  content: string,
  options?: SendWecomTextWebhookOptions,
): Promise<void> {
  const hookUrl = options?.hookUrl ?? DEFAULT_WECOM_WEBHOOK_URL;
  try {
    const res = await fetch(hookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content } }),
    });
    const body = await res.text();
    if (!res.ok) {
      AppLog.logger.warn({ status: res.status, body }, "sendWecomTextWebhook: HTTP error");
      return;
    }
    AppLog.logger.info({ body }, "sendWecomTextWebhook: sent");
  } catch (err) {
    AppLog.logger.error({ err }, "sendWecomTextWebhook: failed");
  }
}
