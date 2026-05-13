import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = join(__dirname, "..", "..", "public", "index.html");
const demoHtmlPath = join(__dirname, "..", "..", "public", "demo.html");
const agentDevHtmlPath = join(__dirname, "..", "..", "public", "agentDev.html");
const agentDevTaskStreamHtmlPath = join(__dirname, "..", "..", "public", "agentDevTaskStream.html");
const devAgentHtmlPath = join(__dirname, "..", "..", "public", "devAgent.html");
const userConfigHtmlPath = join(__dirname, "..", "..", "public", "userConfig.html");

async function sendIndexHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(indexHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendDemoHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(demoHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendAgentDevHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(agentDevHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendAgentDevTaskStreamHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(agentDevTaskStreamHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendDevAgentHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(devAgentHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendUserConfigHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(userConfigHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

export function registerDemoPageRoute(app: FastifyInstance): void {
  app.get("/", async (_req, reply) => {
    return sendIndexHtml(reply);
  });
  app.get("/demo", async (_req, reply) => {
    return sendDemoHtml(reply);
  });
  app.get("/agent-dev", async (_req, reply) => {
    return sendAgentDevHtml(reply);
  });
  app.get("/agent-dev/task-stream", async (_req, reply) => {
    return sendAgentDevTaskStreamHtml(reply);
  });
  app.get("/dev-agent", async (_req, reply) => {
    return sendDevAgentHtml(reply);
  });
  app.get("/user-config", async (_req, reply) => {
    return sendUserConfigHtml(reply);
  });
}
