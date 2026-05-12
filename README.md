# code-agent

基于 **Node.js + Fastify** 的轻量后端：集成 **Claude Agent SDK** 与 **OpenAI Codex SDK**，使用 **SQLite**（`node:sqlite`）持久化会话与消息，并通过 **SSE** 流式返回 Agent 输出。

## 环境要求

- **Node.js ≥ 22.5**（使用内置 `node:sqlite` 的 `DatabaseSync`，避免原生 `better-sqlite3` 在 Windows 上需 MSVC 编译链的问题。）
- 有效的 **Anthropic API Key**（Claude 路由）与 **OpenAI API Key**（Codex 路由，按 SDK 要求配置）。

## 快速开始

```bash
npm install
copy .env.example .env   # Windows；Linux/macOS: cp .env.example .env
```

编辑 `.env`：至少配置 `ANTHROPIC_API_KEY` 与/或 `OPENAI_API_KEY`。若 Codex CLI 不在 `PATH` 上，设置 `CODEX_PATH` 为 `codex` 可执行文件的绝对路径（`@openai/codex-sdk` 会拉起 Codex 子进程）。

```bash
npm run dev              # 开发：tsx watch
npm run build && npm start
```

默认监听 `HOST` + `PORT`（见 [`src/config.ts`](src/config.ts)，未设置时一般为 `127.0.0.1:3000`；`.env.example` 中的端口以你本地为准）。

## 浏览器演示

启动服务后，在浏览器打开：

**`http://<HOST>:<PORT>/`**（与 **`/demo`** 相同页面）

例如 `http://127.0.0.1:3000/`。页面为单文件 HTML（[`public/demo.html`](public/demo.html)），可调试健康检查、会话 REST，以及用 **`fetch` + ReadableStream** 解析 **POST SSE**（见下文「SSE 约定」）。请勿用磁盘 `file://` 打开该 HTML，否则受 CORS 限制无法调用接口。

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 首页，与 `/demo` 同为演示页 |
| `GET` | `/demo` | 演示页（与 `/` 内容相同，便于书签） |
| `GET` | `/health` | 健康检查；含 SQLite `SELECT 1` |
| `GET` | `/api/threads` | 会话列表 |
| `POST` | `/api/threads` | 创建会话；JSON：`{ "title"?: string, "provider": "claude" \| "codex" }` |
| `GET` | `/api/threads/:id/messages` | 历史消息；可选查询参数 `limit`（默认 200，最大 500） |
| `POST` | `/api/agents/claude/sse` | Claude Agent；**SSE** 响应 |
| `POST` | `/api/agents/codex/sse` | Codex Agent；**SSE** 响应 |

### Agent 请求体（Claude / Codex 相同）

```json
{
  "threadId": "可选，UUID；省略则自动创建对应 provider 的新会话",
  "prompt": "必填，用户输入",
  "model": "可选"
}
```

未传 `threadId` 时，流中会先出现一条 **`data:` JSON**，形如 `{ "type": "meta", "threadId": "<应用内 UUID>", "provider": "claude" | "codex" }`，便于前端保存后续续聊用的 id。

### SSE 约定

- `Content-Type: text/event-stream`
- 业务数据多为 `data: <单行 JSON>\n\n`
- 结束：`event: done`，载荷 `{ "ok": true }`
- 错误：`event: error`，载荷含 `message` 等字段

**注意**：`POST` 无法使用浏览器原生 `EventSource`（仅支持 `GET`）。请在浏览器里用 **`fetch` + `ReadableStream`** 解析 SSE，或使用 `curl -N` 等工具调试。

示例（curl）：

```bash
curl -N -X POST http://127.0.0.1:3000/api/agents/claude/sse ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"用一句话介绍你自己\"}"
```

（Linux/macOS 将 `^` 换为 `\`。）

若未配置 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`，对应路由返回 **503** JSON，而非 SSE。

## 数据与目录

- SQLite 文件路径由 **`DATABASE_PATH`** 控制，默认 `./data/app.db`；父目录会自动创建。
- 表：`threads`（含 `external_thread_id` 存 Claude session / Codex thread）、`messages`。

## 安全说明

- **API Key 仅放在服务端环境变量**，勿下发给浏览器。
- 当前 Claude 集成为在无交互环境下跑通，对 SDK 使用了 **`canUseTool` 一律允许**；面向公网或不可信用户前，应改为显式权限策略或网关鉴权。

## 相关文档

- 协作者与自动化代理说明：根目录 [`AGENTS.md`](AGENTS.md)。
