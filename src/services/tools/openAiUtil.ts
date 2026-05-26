import "dotenv/config";
import type { DatabaseSync } from "node:sqlite";
import { resolveOpenAiChatSettings } from "../dbConfig.js";

const DEFAULT_BASE_URL = "http://192.168.210.154:4000/v1";
const DEFAULT_MODEL = "GLM-5";

const trim = (s?: string) => s?.trim() || "";
const trimEndSlash = (s: string) => s.replace(/\/+$/, "");

/** 从环境变量或全局 `system_config` 读取配置并调用 chat/completions */
export async function chat(userPrompt: string, db?: DatabaseSync): Promise<string> {
  const { apiKey, baseUrl, model } = resolveOpenAiChatSettings(db);
  if (!apiKey) {
    throw new Error(
      "OpenAI API Key 未配置：请设置环境变量 OPENAI_API_KEY，或在全局 system_config 中配置 openai_api_key",
    );
  }
  return chatWith(apiKey, baseUrl || DEFAULT_BASE_URL, model || DEFAULT_MODEL, userPrompt);
}

export async function chatWith(
  apiKey: string,
  baseUrl: string,
  model: string,
  userPrompt: string,
): Promise<string> {
  if (!trim(apiKey)) throw new Error("apiKey 不能为空");
  if (!trim(userPrompt)) throw new Error("userPrompt 不能为空");

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
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI 调用失败, status=${res.status}, body=${body}`);
  }

  const json = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (content == null) {
    throw new Error(`OpenAI 返回无 content, body=${body}`);
  }
  return content;
}
