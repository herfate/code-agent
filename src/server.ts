import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { closeDb, getDb } from "./db/client.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerThreadRoutes } from "./routes/threads.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerTaskFollowUpRoutes } from "./routes/taskFollowUp.js";
import { registerParentTaskRoutes } from "./routes/parentTask.js";
import { registerSystemConfigRoutes } from "./routes/systemConfig.js";
import { registerAgentClaudeRoutes } from "./routes/agentClaude.js";
import { registerAgentCodexRoutes } from "./routes/agentCodex.js";
import { registerAgentCursorRoutes } from "./routes/agentCursor.js";
import { registerDemoPageRoute } from "./routes/demoPage.js";
import { registerQaProxyRoutes } from "./routes/qaProxy.js";
import { registerConfluenceProxyRoutes } from "./routes/confluenceProxy.js";
import { registerWikiBaseRoutes } from "./routes/wikiBase.js";
import { initAccessLog, readAccessUserName, writeAccessLog } from "./services/accessLog.js";
import { AppLog } from "./services/appLogger.js";
import { startTaskScanScheduler } from "./services/scheduler/taskScanScheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const config = loadConfig();
const db = getDb(config.DATABASE_PATH);

const app = Fastify({ logger: true });
AppLog.init(app.log);
initAccessLog(config.DATABASE_PATH);

app.addHook("onResponse", (request, reply, done) => {
  writeAccessLog({
    ip: request.ip,
    userName: readAccessUserName(request.headers),
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    responseTimeMs: reply.elapsedTime,
  });
  done();
});

registerHealthRoutes(app, { db });
registerThreadRoutes(app, { db });
registerTaskRoutes(app, { db });
registerTaskFollowUpRoutes(app, { db });
registerParentTaskRoutes(app, { db });
registerSystemConfigRoutes(app, { db });
registerAgentClaudeRoutes(app, { db });
registerAgentCodexRoutes(app, { db });
registerAgentCursorRoutes(app, { db });
registerQaProxyRoutes(app, { db });
registerConfluenceProxyRoutes(app, { db });
registerWikiBaseRoutes(app, { db });
registerDemoPageRoute(app);

let taskScanHandle: ReturnType<typeof startTaskScanScheduler> = null;

const shutdown = async () => {
  taskScanHandle?.stop();
  taskScanHandle = null;
  await app.close();
  closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.register(fastifyStatic, { root: publicDir });
  await app.listen({ port: config.PORT, host: config.HOST });
  taskScanHandle = startTaskScanScheduler({
    db,
    intervalMs: config.TASK_SCAN_INTERVAL_MS,
    batchSize: config.TASK_SCAN_BATCH_SIZE,
  });
  if (taskScanHandle) {
    app.log.info(
      { intervalMs: config.TASK_SCAN_INTERVAL_MS, batchSize: config.TASK_SCAN_BATCH_SIZE },
      "task scan scheduler enabled",
    );
  }
  app.log.info(
    `Web: http://${config.HOST}:${config.PORT}/ 管理台 /demo /agent-dev /agent-dev/task-stream /dev-agent /dev-agent/parent-flow /wiki-agent /user-config /?page=demo /?page=adev /?page=dagent /?page=wagent /?page=ucfg`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
