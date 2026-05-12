import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { closeDb, getDb } from "./db/client.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerThreadRoutes } from "./routes/threads.js";
import { registerAgentClaudeRoutes } from "./routes/agentClaude.js";
import { registerAgentCodexRoutes } from "./routes/agentCodex.js";
import { registerDemoPageRoute } from "./routes/demoPage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const config = loadConfig();
const db = getDb(config.DATABASE_PATH);

const app = Fastify({ logger: true });

registerHealthRoutes(app, { db });
registerThreadRoutes(app, { db });
registerAgentClaudeRoutes(app, { db });
registerAgentCodexRoutes(app, { db });
registerDemoPageRoute(app);

const shutdown = async () => {
  await app.close();
  closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.register(fastifyStatic, { root: publicDir });
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`Home & demo: http://${config.HOST}:${config.PORT}/ (same HTML as /demo)`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
