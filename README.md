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

默认监听 `HOST` + `PORT`（见 [`src/config.ts`](src/config.ts)，未设置时一般为 `127.0.0.1:30001`；`.env.example` 中的端口以你本地为准）。

## 浏览器演示

启动服务后，在浏览器打开：

**`http://<HOST>:<PORT>/`** 为管理台首页（左侧菜单）；**「对话演示」** 嵌入 **`/demo`**；**「开发 Agent」** 嵌入 **`/agent-dev`**（工作流 `tasks` 表查询）；**「用户配置」** 嵌入 **`/user-config`**（`system_config` 表查询）。也可单独打开 **`/agent-dev`**、**`/user-config`**，或使用 **`/demo`**、**`/?page=demo`**、**`/?page=adev`**、**`/?page=ucfg`**。样式见 [`public/app.css`](public/app.css)。请勿用磁盘 `file://` 打开 HTML，否则受 CORS 限制无法调用接口。

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 管理台（`/?page=demo` 嵌入 `/demo`；`/?page=adev` 嵌入 `/agent-dev`；`/?page=ucfg` 嵌入 `/user-config`） |
| `GET` | `/demo` | 对话演示页（REST / Agent SSE 调试；可被管理台 iframe 嵌入） |
| `GET` | `/agent-dev` | 开发 Agent 页（`GET /api/tasks` 查询 `tasks` 表；可嵌入管理台） |
| `GET` | `/user-config` | 用户与系统配置页（`GET /api/system-config` 查询 `system_config` 表；可嵌入管理台） |
| `GET` | `/health` | 健康检查；含 SQLite `SELECT 1` |
| `GET` | `/api/tasks` | 工作流任务列表（表 `tasks`）；可选查询参数：`status`（整数 **1–6**：1 待执行、2 执行中、3 执行完成、4 执行失败、5 已暂停、6 已取消）、`task_type`（当前仅 `1` = 开发任务）、`title`（标题模糊匹配）、`limit`（1–500，默认无筛选时 100） |
| `GET` | `/api/tasks/:taskId/claude-agent-stream` | 按**任务 id**续订该任务最近一次认领执行写入的 Claude Agent **SSE**（内部与 `GET /api/agents/claude/runs/:runId/stream` 相同：`?afterSeq=` 整数 ≥0，默认 0）。要求 `tasks.meta_json` 中存在本次运行的 UUID 字段 **`claudeAgentRunId`**（由服务端在定时认领执行 `handleClaimedTask` 创建 `agent_run` 后写入）。无该字段或任务不存在时返回 **404** JSON。进行中则轮询追新直至 `agent_runs.status` 非 `running`；**进程重启后进行中的 run 无法续**。 |
| `GET` | `/api/system-config` | 系统配置列表（表 `system_config`）；可选：`scope`（`global` \| `user`）、`username`（与 `scope=user` 或单独填写时筛选该用户）、`config_key`（键名子串模糊匹配）、`limit`（1–500，默认 200） |
| `GET` | `/api/threads` | 会话列表；可选查询参数：`provider`（`claude` \| `codex`）、`title`（标题模糊匹配）、`limit`（1–500，默认无筛选时 100、有筛选时默认 100） |
| `POST` | `/api/threads` | 创建会话；JSON：`{ "title"?: string, "provider": "claude" \| "codex" }` |
| `GET` | `/api/threads/:id/messages` | 历史消息；可选查询参数 `limit`（默认 200，最大 500） |
| `POST` | `/api/agents/claude/sse` | Claude Agent；**SSE** 响应（每帧带 `seq` 落库，断连后上游仍在本进程内跑完） |
| `POST` | `/api/agents/codex/sse` | Codex Agent；**SSE** 响应（同上） |
| `GET` | `/api/agents/claude/runs/:runId/stream` | 续订某次 Claude 运行；`?afterSeq=`（整数 ≥0，默认 0）只推送序号大于该值的已存帧，运行中则轮询追新 |
| `GET` | `/api/agents/codex/runs/:runId/stream` | 续订 Codex，同上 |
| `GET` | `/qa/findAllAppInfo` | 转发 QA 平台「全部应用」列表；站点固定 `http://qa.howbuy.pa`，账号见全局 `system_config`：`qa_platform_username`、`qa_platform_password`（`value_json` 可为 JSON 字符串如 `"user"` 或裸文本） |
| `GET` | `/qa/getVersionAndArchiveStatusListByApp` | 转发 QA 平台版本与归档状态；查询参数 `appName`（必填） |
| `POST` | `/qa/getScriptList` | 转发 QA 平台脚本分页查询；JSON 请求体与原 Java 一致（如 `pageNum`、`pageSize`、`data`、`history` 等） |

未配置上述两条全局 `system_config` 时，上述 `/qa/*` 路由返回 **503** JSON（`code` / `message`），与业务错误 **500** 区分。

### Agent 请求体（Claude / Codex 相同）

```json
{
  "threadId": "可选，UUID；省略则自动创建对应 provider 的新会话",
  "prompt": "必填，用户输入",
  "model": "可选"
}
```

未传 `threadId` 时，流中会先出现一条 **`data:` JSON**，形如 `{ "type": "meta", "threadId": "<应用内 UUID>", "provider": "claude" | "codex", "runId": "<本次运行 UUID>", "seq": 1 }`。`runId` 与单调递增的 `seq` 用于 **关页后再开**：`GET /api/agents/claude/runs/:runId/stream?afterSeq=` 或 Codex 同路径（演示页用 `sessionStorage` 自动续订；**服务端进程重启后，进行中的 run 无法续**）。工作流任务由扫描器执行 Claude 时，同一 `runId` 会写入 `tasks.meta_json.claudeAgentRunId`，前端可仅用任务 id 调用 **`GET /api/tasks/:taskId/claude-agent-stream`**（见上表）。
### SSE 约定

- `Content-Type: text/event-stream`
- 业务数据多为 `data: <单行 JSON>\n\n`
- 结束：`event: done`，载荷 `{ "ok": true }`
- 错误：`event: error`，载荷含 `message` 等字段

**注意**：`POST` 无法使用浏览器原生 `EventSource`（仅支持 `GET`）。请在浏览器里用 **`fetch` + `ReadableStream`** 解析 SSE，或使用 `curl -N` 等工具调试。

示例（curl）：

```bash
curl -N -X POST http://127.0.0.1:30001/api/agents/claude/sse ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"用一句话介绍你自己\"}"
```

（Linux/macOS 将 `^` 换为 `\`。）

若未配置 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`，对应路由返回 **503** JSON，而非 SSE。

## 数据与目录

- SQLite 文件路径由 **`DATABASE_PATH`** 控制，默认 `./data/app.db`；父目录会自动创建。
- 表：`threads`、`messages`、**`tasks`** / `subtasks` / `task_params`（工作流）；**`agent_runs` / `agent_run_events`** 记录每次 Agent SSE 运行的状态与可续订帧（`seq`）。

## 安全说明

- **API Key 仅放在服务端环境变量**，勿下发给浏览器。
- 当前 Claude 集成为在无交互环境下跑通，对 SDK 使用了 **`canUseTool` 一律允许**；面向公网或不可信用户前，应改为显式权限策略或网关鉴权。

## 相关文档

- 协作者与自动化代理说明：根目录 [`AGENTS.md`](AGENTS.md)。
