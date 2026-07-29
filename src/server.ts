import Fastify from "fastify";
import multipart from "@fastify/multipart";
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
import { registerSkillPromptConfigRoutes } from "./routes/skillPromptConfig.js";
import { registerAgentClaudeRoutes } from "./routes/agentClaude.js";
import { registerAgentCodexRoutes } from "./routes/agentCodex.js";
import { registerAgentCursorRoutes } from "./routes/agentCursor.js";
import { registerDemoPageRoute } from "./routes/demoPage.js";
import { registerQaProxyRoutes } from "./routes/qaProxy.js";
import { registerConfluenceProxyRoutes } from "./routes/confluenceProxy.js";
import { registerWikiBaseRoutes } from "./routes/wikiBase.js";
import { registerExportToolsRoutes } from "./routes/exportTools.js";
import { registerSshExecRoutes } from "./routes/sshExec.js";
import { registerAppCatalogRoutes } from "./routes/appCatalog.js";
import { registerTapdRoutes } from "./routes/tapd.js";
import { initAccessLog, readAccessUserName, writeAccessLog } from "./services/accessLog.js";
import { AppLog } from "./services/appLogger.js";
import { startTaskScanScheduler } from "./services/scheduler/taskScanScheduler.js";
import { startWikiSyncScheduler } from "./services/scheduler/wikiSyncScheduler.js";
import { WIKI_QA_UPLOAD_MAX_BYTES } from "./services/file/wikiQaAiOutput.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const config = loadConfig();
const db = getDb(config.DATABASE_PATH);

const app = Fastify({ logger: true });
AppLog.init(app.log);
initAccessLog(config.DATABASE_PATH);

await app.register(multipart, {
  limits: {
    fileSize: WIKI_QA_UPLOAD_MAX_BYTES,
    files: 20,
  },
});

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
registerSkillPromptConfigRoutes(app, { db });
registerAgentClaudeRoutes(app, { db });
registerAgentCodexRoutes(app, { db });
registerAgentCursorRoutes(app, { db });
registerQaProxyRoutes(app, { db });
registerConfluenceProxyRoutes(app, { db });
registerWikiBaseRoutes(app, { db });
registerExportToolsRoutes(app);
registerSshExecRoutes(app);
registerAppCatalogRoutes(app);
registerTapdRoutes(app, { db });
registerDemoPageRoute(app);

let taskScanHandle: ReturnType<typeof startTaskScanScheduler> = null;
let wikiSyncHandle: ReturnType<typeof startWikiSyncScheduler> = null;

const shutdown = async () => {
  taskScanHandle?.stop();
  taskScanHandle = null;
  wikiSyncHandle?.stop();
  wikiSyncHandle = null;
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
  wikiSyncHandle = startWikiSyncScheduler({
    db,
    hour: config.WIKI_SYNC_DAILY_HOUR,
    minute: config.WIKI_SYNC_DAILY_MINUTE,
    createPersistMemory: config.WIKI_SYNC_CREATE_PERSIST_MEMORY,
  });
  if (wikiSyncHandle) {
    app.log.info(
      {
        hour: config.WIKI_SYNC_DAILY_HOUR,
        minute: config.WIKI_SYNC_DAILY_MINUTE,
        createPersistMemory: config.WIKI_SYNC_CREATE_PERSIST_MEMORY,
      },
      "wiki sync scheduler enabled",
    );
  }
  app.log.info(
    `Web: http://${config.HOST}:${config.PORT}/ 管理台 /demo /agent-dev /agent-dev/task-stream /dev-agent /dev-agent/parent-flow /wiki-agent /test-agent /rule-agent /user-config /skill-prompt-config /?page=demo /?page=adev /?page=dagent /?page=wagent /?page=tagent /?page=ragent /?page=ucfg /?page=spcfg`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
