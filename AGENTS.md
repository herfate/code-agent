# 仓库说明（协作者与 AI Agent）

本文面向人类开发者与自动化编码代理，说明在本仓库中如何**安全、一致**地协作与改代码。

## 技术栈

- **运行时**：Node.js **≥ 22.5**（需使用内置 `node:sqlite` / `DatabaseSync`）。
- **HTTP**：Fastify 5，TypeScript ESM（`"type": "module"`），开发时用 `tsx`。
- **Agent**：`@anthropic-ai/claude-agent-sdk`（`query()` 异步迭代 → SSE）、`@openai/codex-sdk`（`Codex` + `Thread.runStreamed()` → SSE）、`@cursor/sdk`（`Agent.create` / `Agent.resume` + `run.stream()` → SSE，Local 模式）。
- **持久化**：SQLite，经 [`src/db/client.ts`](src/db/client.ts) 使用 **`node:sqlite`**，**不用** `better-sqlite3`（避免 Windows 上原生编译依赖）。表结构在启动时通过 `CREATE TABLE IF NOT EXISTS` 初始化。

## 重要事项
***使用中文对话, 注释尽量有***

## 目录职责

| 路径 | 作用 |
|------|------|
| [`src/server.ts`](src/server.ts) | 应用入口、注册路由、优雅退出 |
| [`src/config.ts`](src/config.ts) | `dotenv` + Zod 解析环境变量 |
| [`src/db/`](src/db/) | 数据库单例、会话与消息 repository、工作流（[`workflow.ts`](src/db/workflow.ts)）、提示词模板（[`promptTpl.ts`](src/db/promptTpl.ts)）、系统配置（[`systemConfig.ts`](src/db/systemConfig.ts)）、Wiki 文档源（[`wikiSource.ts`](src/db/wikiSource.ts)） |
| [`src/sse/helpers.ts`](src/sse/helpers.ts) | 在 `reply.raw` 上组帧输出 SSE |
| [`src/services/`](src/services/) | Claude / Codex / Cursor 流式封装（[`claudeAgent.ts`](src/services/agentsdk/claudeAgent.ts)、[`codexAgent.ts`](src/services/agentsdk/codexAgent.ts)、[`cursorAgent.ts`](src/services/agentsdk/cursorAgent.ts)）；[`parentTaskCreateService.ts`](src/services/create/task/parentTaskCreateService.ts) 新增父任务并分解 `subtasks`；[`dbConfig.ts`](src/services/dbConfig.ts) 从 `system_config` 读 QA 等；GitLab 键与拼克隆 URL 在 [`gitlabTool.ts`](src/services/tools/gitlabTool.ts) |
| [`src/routes/`](src/routes/) | 各 HTTP 路由插件（含 [`demoPage.ts`](src/routes/demoPage.ts) 提供 `GET /`、`GET /demo`、`GET /agent-dev`、`GET /agent-dev/task-stream`、`GET /dev-agent`、`GET /dev-agent/parent-flow`、`GET /wiki-agent`、`GET /wiki-agent/brainstorm-stories`、`GET /test-agent`、`GET /rule-agent`、`GET /user-config`；[`agentCursor.ts`](src/routes/agentCursor.ts) 提供 Cursor SSE） |
| [`public/index.html`](public/index.html) | 管理台首页（左侧菜单 + 内容区） |
| [`public/demo.html`](public/demo.html) | 对话演示页 |
| [`public/agentDev.html`](public/agentDev.html) | 开发 Agent 独立页（`tasks` 查询） |
| [`public/agentDevTaskStream.html`](public/agentDevTaskStream.html) | 任务 Claude SSE 全屏页（`?taskId=&base=`，由列表「新标签打开」进入） |
| [`public/parentTaskFlow.html`](public/parentTaskFlow.html) | 父任务工作流页（`?pid=&base=&taskId=`：子任务列表 + 内嵌 Claude SSE） |
| [`public/devAgent.html`](public/devAgent.html) | 父任务独立页（`parent_task` 查询与新增） |
| [`public/wikiAgent.html`](public/wikiAgent.html) | Wiki Agent 独立页（`wiki_base` 分类卡片与文档浏览） |
| [`public/brainstormStories.html`](public/brainstormStories.html) | 头脑风暴故事列表页（`?pid=&base=`：故事描述 + 澄清点选） |
| [`public/testAgent.html`](public/testAgent.html) | 测试 Agent 独立页（`parent_task` 类型 5/6） |
| [`public/ruleAgent.html`](public/ruleAgent.html) | Rule Agent 独立页（`parent_task` 类型 7 知识沉淀、类型 8 代码规范、类型 9 业务知识：查询与新增） |
| [`public/userConfig.html`](public/userConfig.html) | 用户配置独立页（`gitlab_token`、`tapd_token` 读写） |
| [`public/app.css`](public/app.css) | Tailwind 构建产物（由 `npm run build` / `build:css` 生成） |
| [`src/styles/tailwind.css`](src/styles/tailwind.css) | Tailwind 入口（`@tailwind` 指令） |
| [`knowledge_base/`](knowledge_base/) | 代码规范与业务核心抽取产物（每条一 md；[`INDEX.md`](knowledge_base/INDEX.md) 总索引） |
| [`skills/`](skills/) | Skill 规范源（`extract-code-style`、`extract-business-core` 等）。知识沉淀子任务 13/14/15 认领时复制到会话 `task-repo/.../.claude/skills/` |

> `GET /` 返回管理台（[`public/index.html`](public/index.html)，含 `/?page=demo` 嵌入 [`/demo`](public/demo.html)、`/?page=adev` 嵌入 [`/agent-dev`](public/agentDev.html)、`/?page=dagent` 嵌入 [`/dev-agent`](public/devAgent.html)、`/?page=wagent` 嵌入 [`/wiki-agent`](public/wikiAgent.html)、`/?page=ragent` 嵌入 [`/rule-agent`](public/ruleAgent.html)、`/?page=ucfg` 嵌入 [`/user-config`](public/userConfig.html)）；`GET /demo`、`GET /agent-dev`、`GET /agent-dev/task-stream`、`GET /dev-agent`、`GET /dev-agent/parent-flow`、`GET /wiki-agent`、`GET /wiki-agent/brainstorm-stories`、`GET /test-agent`、`GET /rule-agent`、`GET /user-config` 分别返回对应独立页面。改界面编辑 `public/index.html`、`public/demo.html`、`public/agentDev.html`、`public/agentDevTaskStream.html`、`public/parentTaskFlow.html`、`public/devAgent.html`、`public/wikiAgent.html`、`public/brainstormStories.html`、`public/testAgent.html`、`public/ruleAgent.html`、`public/userConfig.html` 与 [`src/styles/tailwind.css`](src/styles/tailwind.css)（如 `.form-select`），交付前执行 **`npm run build`**（含 `build:css`）。本地改样式时可并行运行 **`npm run dev:css`**（监听生成 `public/app.css`）与 **`npm run dev`**。静态资源由 `public/` 经 `@fastify/static` 挂载（如 `/app.css`）。

## 约定

- **API Key** 仅允许在服务端（环境变量）；禁止在日志中输出密钥或敏感配置。
- **SSE 路由**：先 `reply.hijack()`，之后只向 `reply.raw` 写入；**hijack 之后不要再调用** `reply.send()`。
- **中止**：通过 `attachAbortOnClose` 在客户端断开时触发 `AbortController`，避免 Agent 任务悬挂。
- **校验**：在路由内用 Zod；若多处复用，可抽到小的共享模块。
- **数据库访问**：统一走 [`src/db/repository.ts`](src/db/repository.ts)；新增 SQL 优先放在 repository，避免在路由里散落拼接。

## 安全（重要）

- 当前 Claude / Cursor Local 集成在无交互环境下会**自动允许工具调用**（Claude：`canUseTool` 一律 `allow`；Cursor Local 默认无人工审批）。这仅适合**开发 / 可信网络**；面向公网、生产或多租户前必须收紧策略。

## Codex CLI

- Codex SDK 会拉起 **Codex CLI**。需保证 `codex` 在 `PATH` 中，或在 `.env` 中设置 **`CODEX_PATH`** 为可执行文件绝对路径（见 [`.env.example`](.env.example)）。

## 对接前端的注意

- Agent 接口为 **POST + SSE**。浏览器原生 **`EventSource` 不支持 POST**；请使用 **`fetch` + 流式解析** 或合适的客户端库。

## 面向使用者的文档

- 安装、环境变量与 HTTP API 表：[`README.md`](README.md)。

## 修改行为时的检查清单

- 新增路由：在 [`src/server.ts`](src/server.ts) 注册，并在 `README.md` 中补充说明。
- 变更环境变量：同步更新 [`.env.example`](.env.example) 与 [`src/config.ts`](src/config.ts)。
- 交付前执行 **`npm run build`**，确保 TypeScript 通过编译。
