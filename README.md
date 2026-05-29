# code-agent

基于 **Node.js + Fastify** 的轻量后端：集成 **Claude Agent SDK**、**OpenAI Codex SDK** 与 **Cursor SDK**（`@cursor/sdk`），使用 **SQLite**（`node:sqlite`）持久化会话与消息，并通过 **SSE** 流式返回 Agent 输出。

## 环境要求

- **Node.js ≥ 22.5**（使用内置 `node:sqlite` 的 `DatabaseSync`，避免原生 `better-sqlite3` 在 Windows 上需 MSVC 编译链的问题。）
- 有效的 **Anthropic API Key**（Claude 路由）、**OpenAI API Key**（Codex 路由）与/或 **Cursor API Key**（Cursor 路由，见 [Cursor SDK](https://cursor.com/docs/sdk/typescript)）。

## 快速开始

```bash
npm install
copy .env.example .env   # Windows；Linux/macOS: cp .env.example .env
```

编辑 `.env`：至少配置 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 与/或 `CURSOR_API_KEY`。若 Codex CLI 不在 `PATH` 上，设置 `CODEX_PATH` 为 `codex` 可执行文件的绝对路径（`@openai/codex-sdk` 会拉起 Codex 子进程）。定时任务默认可通过 `TASK_AGENT_PROVIDER=claude|cursor` 选择 Agent SDK（默认 `claude`）。

```bash
npm run dev              # 开发：tsx watch
npm run build && npm start
```

默认监听 `HOST` + `PORT`（见 [`src/config.ts`](src/config.ts)，未设置时一般为 `127.0.0.1:30001`；`.env.example` 中的端口以你本地为准）。

## 浏览器演示

启动服务后，在浏览器打开：

**`http://<HOST>:<PORT>/`** 为管理台首页（左侧菜单）；**「对话演示」** 嵌入 **`/demo`**；**「开发 Agent」** 嵌入 **`/agent-dev`**（工作流 `tasks` 表查询）；**「父任务」** 嵌入 **`/dev-agent`**（`parent_task` 查询与新增）；**「用户配置」** 嵌入 **`/user-config`**（用户 `gitlab_token`、`anthropic_api_key` 读写）。也可单独打开 **`/agent-dev`**、**`/dev-agent`**、**`/user-config`**，或使用 **`/demo`**、**`/?page=demo`**、**`/?page=adev`**、**`/?page=dagent`**、**`/?page=ucfg`**。样式见 [`public/app.css`](public/app.css)。请勿用磁盘 `file://` 打开 HTML，否则受 CORS 限制无法调用接口。

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 管理台（`/?page=demo` 嵌入 `/demo`；`/?page=adev` 嵌入 `/agent-dev`；`/?page=dagent` 嵌入 `/dev-agent`；`/?page=ucfg` 嵌入 `/user-config`） |
| `GET` | `/demo` | 对话演示页（REST / Agent SSE 调试；可被管理台 iframe 嵌入） |
| `GET` | `/agent-dev` | 开发 Agent 页（`GET /api/tasks` 查询 `tasks` 表；可嵌入管理台） |
| `GET` | `/agent-dev/task-stream` | 任务 Agent SSE **全屏**查看页；查询参数 `taskId`（必填 UUID）、`provider`（可选 `claude` \| `cursor`，默认 `claude`）、`base`（可选 API 根地址） |
| `GET` | `/dev-agent` | 父任务页（`GET/POST /api/parent-tasks`；可嵌入管理台） |
| `GET` | `/dev-agent/parent-flow` | 父任务工作流页：按 `pid` 查询该父任务下全部 `tasks` 与子任务，右侧续订 Claude SSE；查询参数 `pid`（必填）、`base`（可选 API 根）、`taskId`（可选，预选中某工作流任务的 SSE） |
| `GET` | `/user-config` | 用户配置页（`GET/PUT /api/user-config/gitlab-token`、`/api/user-config/anthropic-api-key`；可嵌入管理台） |
| `GET` | `/health` | 健康检查；含 SQLite `SELECT 1` |
| `GET` | `/api/tasks` | 工作流任务列表（表 `tasks`）；可选查询参数：`status`（整数 **1–6**：1 待执行、2 执行中、3 执行完成、4 执行失败、5 已暂停、6 已取消）、`task_type`（整数 **0–10** 或 **101–103**：0 设计、1 开发、2 开发规范优化、3 测试预分析、4 测试案例设计、5 测试数据分析、6 测试案例执行、7 QA 平台测试脚本生成、8 Code Review、9 拆分故事、10 头脑风暴、101 测试环境发布、102 部署间隔等待、103 测试环境发布结果）、`title`（标题模糊匹配）、`limit`（1–500，默认无筛选时 100） |
| `PATCH` | `/api/tasks/:taskId` | 更新任务；JSON 至少含其一：`status`（1–6）、`description`（整段替换）。设为 **1（待执行）** 时清空 `error_message`、`output_json`、`started_at`、`completed_at`、`followUpMessages`，并从 `meta_json` 移除 `claudeAgentRunId` / `cursorAgentRunId`；响应 `{ task }` |
| `POST` | `/api/tasks/:taskId/follow-up` | 追加对话；JSON：`{ "message": string }`。写入 `meta_json.followUpMessages`（**不修改** `description`），设为 **1（待执行）**，清空上轮 `error_message` / `output_json` / `started_at` / `completed_at`，**保留** `cursorAgentRunId` / `claudeAgentRunId`。仅可在执行完成、失败、已暂停或已取消后调用；响应 `{ task }` |
| `GET` | `/api/tasks/:taskId` | 单条任务详情；响应 `{ task, agent_provider }`，`agent_provider` 由任务 `pid` 查父任务 `init` 参数中的 `provider`（无 `pid` 时用 `TASK_AGENT_PROVIDER`） |
| `GET` | `/api/tasks/:taskId/claude-agent-stream` | 按**任务 id**续订 Claude Agent **SSE**（`?afterSeq=`）。要求 `meta_json.claudeAgentRunId` |
| `GET` | `/api/tasks/:taskId/cursor-agent-stream` | 按**任务 id**续订 Cursor Agent **SSE**（`?afterSeq=`）。要求 `meta_json.cursorAgentRunId`（`TASK_AGENT_PROVIDER=cursor` 时由调度器写入） |
| `GET` | `/api/parent-tasks` | 父任务；`?pid=` 返回 `{ parent_task, parent_task_params, tasks?, task?, subtasks?, tasks_with_subtasks? }`（`tasks` 为 `tasks.pid` 关联的任务列表；`task` 为其中开发任务；`tasks_with_subtasks` 为每项任务附带 `subtasks` 数组）；否则列表 `{ parent_tasks, total, page, page_size, total_pages }`，可选 `task_type`、`title`、`creator`、`page`（默认 1）、`limit`（每页条数，默认 20，最大 100） |
| `GET` | `/api/parent-tasks/:pid/ai-out/task-types` | 列出 `ai_out/<pid>/` 下存在可预览文档（`.md` / `.markdown` / `.json` / `.txt`）的 `task_type` 目录；响应 `{ pid, task_types: number[] }` |
| `GET` | `/api/parent-tasks/:pid/ai-out/latest` | 读取 `ai_out/<pid>/<taskType>/` 下 mtime 最新的可预览文档；可选查询参数 `task_type`（0–10 或 101–103，省略则扫描该 pid 下全部任务类型目录）；响应 `{ pid, task_type, relative_path, content, content_kind, updated_at }`（`content_kind` 为 `markdown` \| `json` \| `text`；`.txt` 按内容自动识别 JSON / Markdown / 纯文本）；无文档时 **404** |
| `POST` | `/api/parent-tasks` | 新增父任务并编排：写 `parent_task` / `init` 参数（`branch_version`、可选 `gitRemoteUrl`、`testEnv`、`provider`：`claude` \| `cursor`，省略时用 `TASK_AGENT_PROVIDER`）→ 按 `task_type` 创建子任务流水线（`tasks.pid` = 父任务 pid）：**1** 开发自测（设计→…→测试环境发布→Code Review→…→测试案例执行）、**2** 开发自Review（设计→开发→测试环境发布→Code Review）；JSON 必填 `creator`（写入各 `tasks.creator`，HTTPS 克隆用户名），`pid` 可省略（自动为表中数值型 pid 的 max+1），`task_type` 默认 **1**，另可含 `app`、`requirement`；响应含 `parent_task`、`parent_task_params`、`tasks`、`task` |
| `GET` | `/api/system-config` | 系统配置列表（表 `system_config`）；可选：`scope`（`global` \| `user`）、`username`（与 `scope=user` 或单独填写时筛选该用户）、`config_key`（键名子串模糊匹配）、`limit`（1–500，默认 200） |
| `GET` | `/api/user-config/gitlab-token` | 读取用户 GitLab Token 配置状态；查询参数 `username`（必填）；响应 `{ username, configured, token_masked?, updated_at? }`（不下发完整 token） |
| `PUT` | `/api/user-config/gitlab-token` | 保存或清除用户 GitLab Token；JSON：`{ "username": string, "gitlab_token"?: string }`（`gitlab_token` 留空则删除该用户配置）；响应同上 |
| `GET` | `/api/user-config/anthropic-api-key` | 读取用户 Claude Auth Token 配置状态；查询参数 `username`（必填）；响应格式同上 |
| `PUT` | `/api/user-config/anthropic-api-key` | 保存或清除用户 Claude Auth Token；JSON：`{ "username": string, "anthropic_api_key"?: string }`（留空则删除）；任务执行时写入 `~/.claude.json` 的 `env.ANTHROPIC_AUTH_TOKEN` |
| `GET` | `/api/threads` | 会话列表；可选查询参数：`provider`（`claude` \| `codex` \| `cursor`）、`title`（标题模糊匹配）、`limit`（1–500，默认无筛选时 100、有筛选时默认 100） |
| `POST` | `/api/threads` | 创建会话；JSON：`{ "title"?: string, "provider": "claude" \| "codex" \| "cursor" }` |
| `GET` | `/api/threads/:id/messages` | 历史消息；可选查询参数 `limit`（默认 200，最大 500） |
| `POST` | `/api/agents/claude/sse` | Claude Agent；**SSE** 响应（每帧带 `seq` 落库，断连后上游仍在本进程内跑完） |
| `POST` | `/api/agents/codex/sse` | Codex Agent；**SSE** 响应（同上） |
| `POST` | `/api/agents/cursor/sse` | Cursor Agent（Local，`cwd` 为演示目录）；**SSE** 响应（同上） |
| `GET` | `/api/agents/claude/runs/:runId/stream` | 续订某次 Claude 运行；`?afterSeq=`（整数 ≥0，默认 0）只推送序号大于该值的已存帧，运行中则轮询追新 |
| `GET` | `/api/agents/codex/runs/:runId/stream` | 续订 Codex，同上 |
| `GET` | `/api/agents/cursor/runs/:runId/stream` | 续订 Cursor，同上 |
| `GET` | `/qa/findAllAppInfo` | 转发 QA 平台「全部应用」列表；站点固定 `http://qa.howbuy.pa`，账号见全局 `system_config`：`qa_platform_username`、`qa_platform_password`（`value_json` 可为 JSON 字符串如 `"user"` 或裸文本） |
| `GET` | `/qa/getVersionAndArchiveStatusListByApp` | 转发 QA 平台版本与归档状态；查询参数 `appName`（必填） |
| `POST` | `/qa/getScriptList` | 转发 QA 平台脚本分页查询；JSON 请求体与原 Java 一致（如 `pageNum`、`pageSize`、`data`、`history` 等） |
| `GET` | `/wiki-agent` | Wiki Agent 页面（`wiki_base` 分类卡片与文档浏览） |
| `GET` | `/api/wiki-base/categories` | 列出 Wiki 分类（1 大陆清算、2 大陆资金、3 大陆账户、4 大陆支付）及各自文件数 |
| `GET` | `/api/wiki-base/:categoryId/sources` | 查询该业务分类下基线文档、迭代文档、代码库 1～5（`code_repos` 数组，`code_repo` 为槽位 1 兼容字段） |
| `GET` | `/api/wiki-base/:categoryId/files` | 单层列出子目录与可预览文档；查询参数 `dir`（相对 `wiki_base/<categoryId>/` 的路径，省略为分类根） |
| `GET` | `/api/wiki-base/:categoryId/file` | 读取指定文档；查询参数 `path`（相对 `wiki_base/<categoryId>/` 的路径） |
| `POST` | `/api/wiki-base/:categoryId/sync` | 立即同步：按 `wiki_source` 配置的 Confluence 地址拉取页面树，写入 `wiki_base/<categoryId>/<sourceType>/`（不打包）；JSON 可选 `{ "scope": "descendants" \| "children" }` |
| `POST` | `/api/wiki-base/:categoryId/prepare-qa` | 智能问答前准备：JSON `{ include_confluence_docs?, include_code_repo_slots?: number[], creator? }`（槽位 1～5，至少勾选一项）；同步复制 `wiki_base` 文档，代码库在后台异步克隆；返回 `{ category_id, copied, clone_started, clone_slots, demo_cwd }` |
| `GET` | `/confluence/export` | Confluence 导出**表单页**（Markdown 页面树 zip / 单页 PDF） |
| `GET` | `/confluence/page-tree-to-markdown` | 根页面 + 子孙导出；zip 内含 `{父页面名}_txt/`、`{父页面名}_md/`（内容相同） |
| `POST` | `/confluence/page-tree-to-markdown` | 同上；JSON：`{ "url"?, "pageId"?, "scope"?: "children" \| "descendants" }` |
| `GET` | `/confluence/page-tree-to-pdf` | 根页面 + 子孙逐页 FlyingPDF 导出；zip 内含 `{父页面名}_pdf/` |
| `POST` | `/confluence/page-tree-to-pdf` | 同上；JSON：`{ "url"?, "pageId"?, "scope"?: "children" \| "descendants" }` |

未配置上述两条全局 `system_config` 时，上述 `/qa/*` 路由返回 **503** JSON（`code` / `message`），与业务错误 **500** 区分。

未配置 Confluence 凭据时，`/confluence/page-tree-to-markdown` 与 `/confluence/page-tree-to-pdf` 返回 **503** JSON。

### Agent 请求体（Claude / Codex 相同）

```json
{
  "threadId": "可选，UUID；省略则自动创建对应 provider 的新会话",
  "prompt": "必填，用户输入",
  "model": "可选"
}
```

未传 `threadId` 时，流中会先出现一条 **`data:` JSON**，形如 `{ "type": "meta", "threadId": "<应用内 UUID>", "provider": "claude" | "codex" | "cursor", "runId": "<本次运行 UUID>", "seq": 1 }`。`runId` 与单调递增的 `seq` 用于 **关页后再开**：`GET /api/agents/{claude|codex|cursor}/runs/:runId/stream?afterSeq=`（演示页用 `sessionStorage` 自动续订；**服务端进程重启后，进行中的 run 无法续**）。工作流任务由扫描器执行时，同一 `runId` 会写入 `tasks.meta_json` 的 `claudeAgentRunId` 或 `cursorAgentRunId`。
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

若未配置 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CURSOR_API_KEY`，对应路由返回 **503** JSON，而非 SSE。

## 数据与目录

- SQLite 文件路径由 **`DATABASE_PATH`** 控制，默认 `./data/app.db`；父目录会自动创建。
- 表：`threads`、`messages`、**`tasks`** / `subtasks`、**`parent_task`** / `parent_task_params`（工作流）；**`agent_runs` / `agent_run_events`** 记录每次 Agent SSE 运行的状态与可续订帧（`seq`）。
- Code Review 报告格式与门禁字段示例：[`docs/examples/`](docs/examples/README.md)（解析后写入 `CodeReviewMergeAllowed`、`CodeReviewGateResult`）。

## 安全说明

- **API Key 仅放在服务端环境变量**，勿下发给浏览器。
- 当前 Claude 集成为在无交互环境下跑通，对 SDK 使用了 **`canUseTool` 一律允许**；面向公网或不可信用户前，应改为显式权限策略或网关鉴权。

## 相关文档

- 协作者与自动化代理说明：根目录 [`AGENTS.md`](AGENTS.md)。
