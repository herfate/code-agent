import "dotenv/config";
import type { DatabaseSync } from "node:sqlite";
import { resolveMultimodalChatSettings } from "../dbConfig.js";

const DEFAULT_BASE_URL = "https://api-inference.modelscope.cn/v1/";
const DEFAULT_MODEL = "stepfun-ai/Step-3.7-Flash";

const trim = (s?: string) => s?.trim() || "";
const trimEndSlash = (s: string) => s.replace(/\/+$/, "");

/** 图片输入：HTTP(S) URL 或 `data:image/...;base64,...` */
export type MultimodalImageInput = {
  url: string;
  detail?: "auto" | "low" | "high";
};

export type MultimodalContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

/** Buffer → data URL，便于本地图片直接送入多模态接口 */
export function bufferToDataUrl(buffer: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/** 从环境变量或全局 `system_config` 读取独立多模态配置并调用 chat/completions */
export async function chat(
  userPrompt: string,
  images: MultimodalImageInput[] = [],
  db?: DatabaseSync,
): Promise<string> {
  const { apiKey, baseUrl, model } = resolveMultimodalChatSettings(db);
  if (!apiKey) {
    throw new Error("MULTIMODAL_API_KEY_MISSING");
  }
  return chatWith(apiKey, baseUrl || DEFAULT_BASE_URL, model || DEFAULT_MODEL, userPrompt, images);
}

export async function chatWith(
  apiKey: string,
  baseUrl: string,
  model: string,
  userPrompt: string,
  images: MultimodalImageInput[] = [],
): Promise<string> {
  if (!trim(apiKey)) throw new Error("apiKey 不能为空");
  if (!trim(userPrompt) && images.length === 0) {
    throw new Error("userPrompt 与 images 不能同时为空");
  }

  const content: MultimodalContentPart[] = [];
  if (trim(userPrompt)) {
    content.push({ type: "text", text: userPrompt });
  }
  for (const img of images) {
    const url = trim(img.url);
    if (!url) continue;
    content.push({
      type: "image_url",
      image_url: img.detail ? { url, detail: img.detail } : { url },
    });
  }
  if (content.length === 0) {
    throw new Error("有效的 userPrompt / images 为空");
  }

  const endpoint = `${trimEndSlash(baseUrl || DEFAULT_BASE_URL)}/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are a helpful multimodal assistant." },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`多模态调用失败, status=${res.status}, body=${body}`);
  }

  const json = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const result = json.choices?.[0]?.message?.content;
  if (result == null) {
    throw new Error(`多模态返回无 content, body=${body}`);
  }
  return result;
}
