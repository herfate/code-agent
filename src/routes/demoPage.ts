import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = join(__dirname, "..", "..", "public", "index.html");
const demoHtmlPath = join(__dirname, "..", "..", "public", "demo.html");
const agentDevHtmlPath = join(__dirname, "..", "..", "public", "agentDev.html");
const agentDevTaskStreamHtmlPath = join(__dirname, "..", "..", "public", "agentDevTaskStream.html");
const parentTaskFlowHtmlPath = join(__dirname, "..", "..", "public", "parentTaskFlow.html");
const brainstormStoriesHtmlPath = join(__dirname, "..", "..", "public", "brainstormStories.html");
const devAgentHtmlPath = join(__dirname, "..", "..", "public", "devAgent.html");
const wikiAgentHtmlPath = join(__dirname, "..", "..", "public", "wikiAgent.html");
const userConfigHtmlPath = join(__dirname, "..", "..", "public", "userConfig.html");
const skillPromptConfigHtmlPath = join(__dirname, "..", "..", "public", "skillPromptConfig.html");
const testAgentHtmlPath = join(__dirname, "..", "..", "public", "testAgent.html");
const kanbanHtmlPath = join(__dirname, "..", "..", "public", "kanban.html");

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

async function sendParentTaskFlowHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(parentTaskFlowHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendBrainstormStoriesHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(brainstormStoriesHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendDevAgentHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(devAgentHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendWikiAgentHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(wikiAgentHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendUserConfigHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(userConfigHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendSkillPromptConfigHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(skillPromptConfigHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendTestAgentHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(testAgentHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

async function sendKanbanHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(kanbanHtmlPath, "utf8");
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
  app.get("/dev-agent/parent-flow", async (_req, reply) => {
    return sendParentTaskFlowHtml(reply);
  });
  app.get("/dev-agent", async (_req, reply) => {
    return sendDevAgentHtml(reply);
  });
  app.get("/wiki-agent/brainstorm-stories", async (_req, reply) => {
    return sendBrainstormStoriesHtml(reply);
  });
  app.get("/wiki-agent", async (req, reply) => {
    const embed = (req.query as { embed?: string }).embed;
    // 直接访问时进入管理台（含左侧菜单与 Keycloak 登录）；iframe 嵌入时带 embed=1
    if (embed !== "1" && embed !== "true") {
      return reply.redirect("/?page=wagent");
    }
    return sendWikiAgentHtml(reply);
  });
  app.get("/user-config", async (_req, reply) => {
    return sendUserConfigHtml(reply);
  });
  app.get("/skill-prompt-config", async (_req, reply) => {
    return sendSkillPromptConfigHtml(reply);
  });
  app.get("/test-agent", async (_req, reply) => {
    return sendTestAgentHtml(reply);
  });
  app.get("/kanban", async (_req, reply) => {
    return sendKanbanHtml(reply);
  });
}
