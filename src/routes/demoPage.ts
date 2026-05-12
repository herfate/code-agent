import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoHtmlPath = join(__dirname, "..", "..", "public", "demo.html");

async function sendDemoHtml(reply: FastifyReply): Promise<void> {
  const html = await readFile(demoHtmlPath, "utf8");
  await reply.type("text/html; charset=utf-8").send(html);
}

export function registerDemoPageRoute(app: FastifyInstance): void {
  app.get("/", async (_req, reply) => {
    return sendDemoHtml(reply);
  });
  app.get("/demo", async (_req, reply) => {
    return sendDemoHtml(reply);
  });
}
