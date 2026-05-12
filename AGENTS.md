# 仓库说明（协作者与 AI Agent）

本文面向人类开发者与自动化编码代理，说明在本仓库中如何**安全、一致**地协作与改代码。

## 技术栈

- **运行时**：Node.js **≥ 22.5**（需使用内置 `node:sqlite` / `DatabaseSync`）。
- **HTTP**：Fastify 5，TypeScript ESM（`"type": "module"`），开发时用 `tsx`。
- **Agent**：`@anthropic-ai/claude-agent-sdk`（`query()` 异步迭代 → SSE）、`@openai/codex-sdk`（`Codex` + `Thread.runStreamed()` → SSE）。
- **持久化**：SQLite，经 [`src/db/client.ts`](src/db/client.ts) 使用 **`node:sqlite`**，**不用** `better-sqlite3`（避免 Windows 上原生编译依赖）。表结构在启动时通过 `CREATE TABLE IF NOT EXISTS` 初始化。

## 目录职责

| 路径 | 作用 |
|------|------|
| [`src/server.ts`](src/server.ts) | 应用入口、注册路由、优雅退出 |
| [`src/config.ts`](src/config.ts) | `dotenv` + Zod 解析环境变量 |
| [`src/db/`](src/db/) | 数据库单例、会话与消息的 repository |
| [`src/sse/helpers.ts`](src/sse/helpers.ts) | 在 `reply.raw` 上组帧输出 SSE |
| [`src/services/`](src/services/) | Claude / Codex 流式封装 |
| [`src/routes/`](src/routes/) | 各 HTTP 路由插件（含 [`demoPage.ts`](src/routes/demoPage.ts) 提供 `GET /` 与 `GET /demo`） |
| [`public/demo.html`](public/demo.html) | 浏览器演示页 HTML；样式类名供 Tailwind 扫描 |
| [`public/demo.css`](public/demo.css) | Tailwind 构建产物（由 `npm run build` / `build:css` 生成） |
| [`src/styles/tailwind.css`](src/styles/tailwind.css) | Tailwind 入口（`@tailwind` 指令） |

> 演示页由 `GET /` 与 `GET /demo` 返回同一 HTML；改界面编辑 `public/demo.html` 与 `src/styles/tailwind.css`，交付前执行 **`npm run build`**（含 `build:css`）。本地改样式时可并行运行 **`npm run dev:css`**（监听生成 `public/demo.css`）与 **`npm run dev`**。静态资源由 `public/` 经 `@fastify/static` 挂载（如 `/demo.css`）。

## 约定

- **API Key** 仅允许在服务端（环境变量）；禁止在日志中输出密钥或敏感配置。
- **SSE 路由**：先 `reply.hijack()`，之后只向 `reply.raw` 写入；**hijack 之后不要再调用** `reply.send()`。
- **中止**：通过 `attachAbortOnClose` 在客户端断开时触发 `AbortController`，避免 Agent 任务悬挂。
- **校验**：在路由内用 Zod；若多处复用，可抽到小的共享模块。
- **数据库访问**：统一走 [`src/db/repository.ts`](src/db/repository.ts)；新增 SQL 优先放在 repository，避免在路由里散落拼接。

## 安全（重要）

- 当前 Claude 集成对 SDK 使用 **`canUseTool` 一律 `allow`**，以便无交互环境不因权限询问阻塞。这仅适合**开发 / 可信网络**；面向公网、生产或多租户前必须收紧策略。

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
