# 父任务提交手册（AI · 类型 1/2/3 · Windows）

面向自动化 Agent / 脚本：通过 HTTP 向 **code-agent** 提交**开发编排类父任务**（`task_type` = **1**、**2**、**3**）。本文不含类型 4（业务 Agent / Wiki 拆分故事）。

---

## 1. 前置条件

| 项 | 说明 |
|----|------|
| 服务已启动 | 项目根目录执行 `npm run dev` 或 `npm start` |
| 服务地址 | `http://192.168.143.42:30001/` |
| Git 可用 | Windows 已安装 Git，且 `git` 在 `PATH` 中 |
| 用户账号 | `creator` 填**已提前配置好**的 GitLab 用户名（Token 由平台侧维护，提交时无需再配） |

---

## 2. 接口概览

| 项 | 值 |
|----|-----|
| 方法 | `POST` |
| 路径 | `/api/parent-tasks` |
| Content-Type | `application/json; charset=utf-8` |
| 成功 | **201**，响应含 `parent_task`、`parent_task_params`、`tasks`、`task` |
| 校验失败 | **400**，`{ "error": { "fieldErrors": { ... } } }` |
| pid 冲突 | **409**，`{ "error": "parent task already exists" }` |

校验逻辑见 [`src/validation/parentTaskCreateZod.ts`](../src/validation/parentTaskCreateZod.ts)。

---

## 3. 父任务类型（仅 1 / 2 / 3）

| task_type | 名称 | 子任务流水线（概要） |
|-----------|------|----------------------|
| **1** | 开发自测 Agent | 设计 → 测试预分析 → 开发 → 测试环境发布 → Code Review → 发布结果 → 测试案例设计 → 测试数据分析 → 测试案例执行 |
| **2** | 开发自 Review Agent | 设计 → 开发 → 测试环境发布 → Code Review → 发布结果（**未填 testEnv 时跳过发布相关节点**） |
| **3** | 功能测试 Agent | 测试环境发布 → 测试预分析 → 测试案例设计 → 测试数据分析 → 测试案例执行 |

> **注意**：上表为**父任务** `task_type`（1/2/3），与子任务 `tasks.task_type`（0 设计、1 开发、101 测试环境发布等）不是同一套枚举。

---

## 4. 默认填值说明（AI）

用户未明确指定时，按以下默认值组装请求体；**仅 `description` 与 `gitRepos` 的分支需结合对话内容判断**。

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `task_type` | `1` | 开发自测 Agent；用户明确要求类型 2/3 时再改 |
| `creator` | `jiangwei.ji` | 固定使用已配置账号 |
| `testEnv` | `it01` | 类型 1 / 3 必填；类型 2 可不传 |
| `description` | **从用户对话提取** | 概括本次需求目标、范围、关键变更点；不可为空 |
| `gitRepos` | **按需求选仓库** | 见下表；`branch_version` 从对话提取，无则向用户确认 |
| `provider` | `claude` | 用户指定 `cursor` 时再改 |

> **提交后**：每次成功提交须将记录落盘至 `C:\work\parent-task-records\`，详见 [§7.2](#72-提交记录落盘必做)。

### 4.1 仓库选择（gitRepos）

按需求所属业务域选择**一组**仓库（多数任务只填一个；跨域改造时才填两个）：

| 业务域 | gitRemoteUrl | 说明 |
|--------|--------------|------|
| **大陆资金** | `http://gitlab-code.howbuy.pa/fin/fin-console` | 大陆资金系统相关需求 |
| **海外资金** | `http://gitlab-code.howbuy.pa/hk-fin/hk-fin` | 香港 / 海外资金相关需求 |

判断规则：

- 对话提到「大陆资金」「fin-console」「国内资金」等 → 用 **fin-console**
- 对话提到「海外资金」「香港资金」「hk-fin」等 → 用 **hk-fin**
- 无法判断时 → **先向用户确认**再提交，勿随意猜测

示例（大陆资金，分支 `feature/xxx`）：

```json
"gitRepos": [
  {
    "gitRemoteUrl": "http://gitlab-code.howbuy.pa/fin/fin-console",
    "branch_version": "feature/xxx"
  }
]
```

示例（海外资金）：

```json
"gitRepos": [
  {
    "gitRemoteUrl": "http://gitlab-code.howbuy.pa/hk-fin/hk-fin",
    "branch_version": "feature/xxx"
  }
]
```

### 4.2 默认完整请求示例（类型 1 · 大陆资金）

```json
{
  "task_type": 1,
  "creator": "jiangwei.ji",
  "description": "（从用户对话提取：需求背景 + 要做什么 + 验收要点）",
  "testEnv": "it01",
  "provider": "claude",
  "gitRepos": [
    {
      "gitRemoteUrl": "http://gitlab-code.howbuy.pa/fin/fin-console",
      "branch_version": "（从对话提取或向用户确认）"
    }
  ]
}
```

---

## 5. 请求字段

### 5.1 按类型必填 / 选填

| 字段 | 类型 1 | 类型 2 | 类型 3 | 说明 |
|------|:------:|:------:|:------:|------|
| `creator` | ✅ | ✅ | ✅ | 默认 `jiangwei.ji`（已配置 GitLab 账号） |
| `description` | ✅ | ✅ | ✅ | 任务说明（≤ 50000 字符） |
| `gitRepos` | ✅ ≥1 组 | ✅ ≥1 组 | ✅ ≥1 组 | 仓库与分支列表（最多 20 组） |
| `testEnv` | ✅ | ⭕ 可选 | ✅ | 默认 `it01`（≤ 200 字符） |
| `task_type` | 建议显式传 `1` | 建议显式传 `2` | 建议显式传 `3` | 省略时服务端默认 **1** |
| `provider` | ⭕ | ⭕ | ⭕ | `claude` \| `cursor`；省略用环境变量 `TASK_AGENT_PROVIDER` |
| `requirement` | ⭕ | ⭕ | ⭕ | 写入子任务 `input_json.requirement`；省略则用 `description` |
| `app` | ⭕ | ⭕ | ⭕ | QA 平台应用名（测试发布等工具任务使用） |
| `title` | ⭕ | ⭕ | ⭕ | 父任务标题；省略则占位，后续 AI 异步生成 |
| `pid` | ⭕ | ⭕ | ⭕ | 父任务编号；省略则自动 `max(数值型 pid)+1` |
| `directDevAfterDesign` | ⭕ | ⭕ | ⭕ | `true`：测试预分析完成后不暂停，自动推进（类型 1 常用） |
| `params` | ⭕ | ⭕ | ⭕ | 额外 `parent_task_params`；**禁止**手动传 `init` 等保留键 |

### 5.2 gitRepos 结构

```json
"gitRepos": [
  {
    "gitRemoteUrl": "http://gitlab-code.howbuy.pa/fin/fin-console",
    "branch_version": "feature/my-branch"
  }
]
```

规则：

- `gitRemoteUrl`：HTTP(S) 地址，1–2000 字符；服务端会自动去掉末尾 `.git`
- `branch_version`：分支名，1–500 字符
- 多仓库时数组可有多项；按 URL 去重
- 克隆鉴权由平台按 `creator` 自动处理，**提交请求中无需携带 Token**

### 5.3 推荐 JSON 模板

**类型 1 — 开发自测**

```json
{
  "task_type": 1,
  "creator": "jiangwei.ji",
  "description": "大陆资金：支持 XXX 业务校验",
  "requirement": "详细需求 Markdown 或纯文本（可长于 description）",
  "testEnv": "it01",
  "provider": "claude",
  "directDevAfterDesign": false,
  "gitRepos": [
    {
      "gitRemoteUrl": "http://gitlab-code.howbuy.pa/fin/fin-console",
      "branch_version": "feature/xxx"
    }
  ]
}
```

**类型 2 — 开发自 Review（可不填 testEnv）**

```json
{
  "task_type": 2,
  "creator": "jiangwei.ji",
  "description": "仅开发 + Code Review，不走完整测试流水线",
  "gitRepos": [
    {
      "gitRemoteUrl": "http://gitlab-code.howbuy.pa/fin/fin-console",
      "branch_version": "feature/xxx"
    }
  ],
  "provider": "claude"
}
```

**类型 3 — 功能测试**

```json
{
  "task_type": 3,
  "creator": "jiangwei.ji",
  "description": "对已发布分支执行功能测试案例",
  "testEnv": "it01",
  "gitRepos": [
    {
      "gitRemoteUrl": "http://gitlab-code.howbuy.pa/hk-fin/hk-fin",
      "branch_version": "release/3.43.0"
    }
  ]
}
```

---

## 6. Windows 提交方式

### 6.1 推荐：JSON 文件 + PowerShell

避免在命令行手写长 JSON 与转义问题。

**步骤 1**：保存请求体，例如 `C:\work\task-submit.json`（UTF-8 无 BOM）。

**步骤 2**：提交

```powershell
Invoke-RestMethod `
  -Uri "http://192.168.143.42:30001/api/parent-tasks" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -InFile "C:\work\task-submit.json"
```

**步骤 3**：保存返回的 `parent_task.pid`，用于后续查询。

### 6.2 PowerShell 内联 JSON

```powershell
$body = @{
  task_type   = 1
  creator     = "jiangwei.ji"
  description = "大陆资金：支持 XXX"
  testEnv     = "it01"
  provider    = "claude"
  gitRepos    = @(
    @{
      gitRemoteUrl   = "http://gitlab-code.howbuy.pa/fin/fin-console"
      branch_version = "feature/xxx"
    }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "http://192.168.143.42:30001/api/parent-tasks" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

### 6.3 curl（cmd.exe）

cmd 中用 `^` 续行；JSON 建议同样用文件：

```bat
curl -X POST "http://192.168.143.42:30001/api/parent-tasks" ^
  -H "Content-Type: application/json; charset=utf-8" ^
  -d @C:\work\task-submit.json
```

内联示例（注意双引号转义）：

```bat
curl -X POST "http://192.168.143.42:30001/api/parent-tasks" ^
  -H "Content-Type: application/json" ^
  -d "{\"task_type\":1,\"creator\":\"jiangwei.ji\",\"description\":\"测试任务\",\"testEnv\":\"it01\",\"gitRepos\":[{\"gitRemoteUrl\":\"http://gitlab-code.howbuy.pa/fin/fin-console\",\"branch_version\":\"master\"}]}"
```

### 6.4 Git Bash / WSL

与 Linux 相同，使用 `\` 续行或 `@file`：

```bash
curl -X POST "http://192.168.143.42:30001/api/parent-tasks" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d @/c/work/task-submit.json
```

---

## 7. 成功响应与后续操作

### 7.1 响应结构（201）

```json
{
  "parent_task": {
    "pid": "42",
    "title": "（待 AI 汇总）",
    "description": "...",
    "task_type": 1,
    "created_at": 1710000000000,
    "updated_at": 1710000000000
  },
  "parent_task_params": [ { "param_key": "init", "value_json": "..." } ],
  "tasks": [ { "id": "uuid", "task_type": 0, "status": 1, "title": "...", ... } ],
  "task": { "id": "uuid", "task_type": 1, ... }
}
```

**务必记录** `parent_task.pid` 与各 `tasks[].id`。

### 7.2 提交记录落盘（必做）

**每次提交成功后**，必须把本次提交记录写入本地文件，并在后续对话中**记住该文件的完整路径**（便于用户追问、复查或再次打开工作流页）。

#### 保存目录（默认）

```
C:\work\parent-task-records\
```

目录不存在时先创建。单次提交一个 JSON 文件，文件名建议：

```
{yyyy-MM-dd_HHmmss}_pid-{pid}.json
```

示例：`C:\work\parent-task-records\2026-06-18_143052_pid-81.json`

#### 文件内容建议

至少包含：

| 字段 | 说明 |
|------|------|
| `submitted_at` | 提交时间（ISO 8601） |
| `request` | 本次 POST 请求体 |
| `response` | 服务端 201 响应全文 |
| `pid` | `parent_task.pid` |
| `parent_flow_url` | `http://192.168.143.42:30001/dev-agent/parent-flow?pid={pid}` |
| `saved_path` | 本文件的绝对路径（与落盘路径一致） |

#### PowerShell 示例（提交 + 落盘）

```powershell
$recordDir = "C:\work\parent-task-records"
New-Item -ItemType Directory -Force -Path $recordDir | Out-Null

$requestBody = Get-Content "C:\work\task-submit.json" -Raw -Encoding UTF8

$response = Invoke-RestMethod `
  -Uri "http://192.168.143.42:30001/api/parent-tasks" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($requestBody))

$pid = $response.parent_task.pid
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$savedPath = Join-Path $recordDir "${timestamp}_pid-${pid}.json"

$record = [ordered]@{
  submitted_at     = (Get-Date).ToString("o")
  request          = ($requestBody | ConvertFrom-Json)
  response         = $response
  pid              = $pid
  parent_flow_url  = "http://192.168.143.42:30001/dev-agent/parent-flow?pid=$pid"
  saved_path       = $savedPath
}

$record | ConvertTo-Json -Depth 10 | Set-Content -Path $savedPath -Encoding UTF8

Write-Host "提交成功 pid=$pid"
Write-Host "记录已保存: $savedPath"
```

#### AI 必须做到

1. 提交成功后**立即落盘**，不要只口头告知 pid
2. 在回复中明确写出 **`saved_path` 完整路径**
3. 同一会话后续若用户问「上次任务」「pid 多少」「记录在哪」，优先根据已保存路径读取，勿重复提交

### 7.3 查询父任务状态

```powershell
Invoke-RestMethod -Uri "http://192.168.143.42:30001/api/parent-tasks?pid=42"
```

### 7.4 父任务视图页面

提交成功后，可在浏览器打开**父任务工作流页**查看该 pid 下全部子任务进度与 Agent 输出。

**URL 格式**（将 `{pid}` 换为提交响应中的 `parent_task.pid`）：

```
http://192.168.143.42:30001/dev-agent/parent-flow?pid={pid}
```

**示例**（父任务编号 81）：

```
http://192.168.143.42:30001/dev-agent/parent-flow?pid=81
```

页面说明：

- 左侧展示该父任务下的**子任务流水线**（设计、开发、测试环境发布等）及各自执行状态
- 点击子任务可展开查看 **Agent SSE** 实时输出
- 页头可修改 pid 后点「加载」，切换查看其他父任务

| 相关页面 | URL |
|----------|-----|
| 父任务列表（新建 / 查询） | `http://192.168.143.42:30001/dev-agent` |
| 父任务工作流（按 pid 查看） | `http://192.168.143.42:30001/dev-agent/parent-flow?pid={pid}` |

### 7.5 调度说明

- 子任务初始 `status = 1`（待执行）
- 需服务端开启任务扫描（`.env` 中 `TASK_SCAN_INTERVAL_MS > 0`，默认 30000 ms）
- 认领后工作目录：`task-repo/<pid>_<workspaceId>/`（相对 code-agent 项目根；每次新认领生成 workspaceId，续跑复用同一目录）

---

## 8. 远程日志查看（SSH exec）

通过 HTTP 在**目标机器**上执行 shell 命令并获取输出，常用于排查测试环境日志。堡垒机账号由服务端 `.env` 维护，**请求体只需传 `command` 与 `targetHost`**。

### 8.1 接口概览

| 项 | 值 |
|----|-----|
| 方法 | `POST` |
| 路径 | `/api/ssh/exec` |
| Content-Type | `application/json; charset=utf-8` |
| 成功 | **200**，`{ "code": 200, "message": "success", "data": { "stdout", "stderr", "exitCode", ... } }` |
| 未配置 SSH | **503** |
| 执行失败 / 超时 | **500** |

### 8.2 请求字段（仅 2 项）

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `command` | ✅ | 远程 shell 命令 |
| `targetHost` | ✅ | 目标机 IP（经堡垒机穿透登录） |

### 8.3 默认命令（按业务域）

与 [§4.1 仓库选择](#41-仓库选择gitrepos) 对应；用户未指定时，按需求所属域选用下表默认值：

| 业务域 | targetHost | 默认 command |
|--------|------------|--------------|
| **大陆资金** | `10.11.102.208` | `tail -300 /data/logs/tomcat-fin-console/fin-console/common.log` |
| **海外资金** | `10.91.11.47` 或 `10.91.11.19` | `tail -300 /data/logs/hk-fin-service/hk-fin/hk-fin.log` |

海外资金两台主机择一即可；不确定时向用户确认环境对应 IP。

**大陆资金 — 默认请求体：**

```json
{
  "command": "tail -300 /data/logs/tomcat-fin-console/fin-console/common.log",
  "targetHost": "10.11.102.208"
}
```

**海外资金 — 默认请求体（示例 IP 10.91.11.47）：**

```json
{
  "command": "tail -300 /data/logs/hk-fin-service/hk-fin/hk-fin.log",
  "targetHost": "10.91.11.47"
}
```

### 8.4 Windows 调用示例

**PowerShell（推荐）**

```powershell
$body = @{
  command    = "tail -300 /data/logs/tomcat-fin-console/fin-console/common.log"
  targetHost = "10.11.102.208"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://192.168.143.42:30001/api/ssh/exec" `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

**curl（cmd.exe）**

```bat
curl -X POST "http://192.168.143.42:30001/api/ssh/exec" ^
  -H "Content-Type: application/json; charset=utf-8" ^
  -d "{\"command\":\"tail -300 /data/logs/tomcat-fin-console/fin-console/common.log\",\"targetHost\":\"10.11.102.208\"}"
```

### 8.5 成功响应示例

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "stdout": "（日志正文，最近 300 行）",
    "stderr": "",
    "exitCode": 0,
    "bastion": { "host": "10.14.100.31", "port": 22222 },
    "target": { "host": "10.11.102.208", "user": "log" },
    "timeoutMs": 5000
  }
}
```

AI 应优先将 `data.stdout` 中的日志内容呈现给用户；若 `exitCode` 非 0 或 `stderr` 非空，一并说明。

### 8.6 AI 默认规则

- 对话涉及**大陆资金 / fin-console** 日志 → 使用 §8.3 大陆资金默认 `command` + `targetHost`
- 对话涉及**海外资金 / hk-fin** 日志 → 使用 §8.3 海外资金默认 `command`；`targetHost` 在 `10.91.11.47` / `10.91.11.19` 中按用户环境选择
- 用户已给出具体命令或 IP 时 → 以用户为准，勿强行覆盖
- **勿使用 `tail -f`**（持续跟随不会结束，易触发服务端超时）；查看最近日志用 `tail -n 300` 或 `tail -300`

### 8.7 额外说明：Keycloak SSO / 堡垒机账号

手动登录堡垒机 Web 或 Keycloak SSO 时，使用以下**密码账户**（与 `POST /api/ssh/exec` 所用服务端 `.env` 配置一致，供人工排查、Xshell 验证时参考）：

| 项 | 值 |
|----|-----|
| 登录方式 | **Keycloak SSO**（密码账户） |
| 用户名 | `jiangwei.ji` |
| 密码 | `Howbuy2007` |

> **注意**：`/api/ssh/exec` 请求体**无需**传用户名密码；仅当 AI/用户需自行用 Xshell、浏览器登录堡垒机或 SSO 时使用上表。勿在对话或日志中扩散密码。

---

## 9. 常见错误

| HTTP | 原因 | 处理 |
|------|------|------|
| 400 | 缺少 `description`（类型 1/2/3） | 补全说明 |
| 400 | `gitRepos` 为空（类型 1/2/3） | 至少一组仓库 + 分支 |
| 400 | 类型 1/3 缺少 `testEnv` | 填写测试环境 |
| 400 | `creator` 为空 | 传非空 GitLab 用户名 |
| 400 | `param_key` 为保留键（如 `init`） | 改用顶层字段，勿手写 `init` |
| 409 | `pid` 已存在 | 换 pid 或省略 pid 自动分配 |
| 500 | 服务内部错误 | 查看服务端日志 |

校验错误示例：

```json
{
  "error": {
    "fieldErrors": {
      "testEnv": ["testEnv is required for task_type 1 or 3"]
    },
    "formErrors": []
  }
}
```

---

## 10. AI 提交前检查清单

在调用 `POST /api/parent-tasks` 前，逐项确认：

- [ ] `task_type` 为 **1**、**2** 或 **3**（未指定时默认 **1**）
- [ ] `creator` 为 `jiangwei.ji`（或用户明确指定的其他已配置账号）
- [ ] `description` 已从对话提取并非空
- [ ] `gitRepos` 已按需求选对仓库（大陆 **fin-console** / 海外 **hk-fin**），分支非空
- [ ] 类型 **1** 或 **3** 时 `testEnv` 为 `it01`（或用户指定值）
- [ ] 未在 `params` 中传入 `init` 等系统保留键
- [ ] code-agent 服务可达（可先 `GET /health`）
- [ ] 已保存响应中的 `pid`，并可用 `parent-flow?pid=` 页面跟踪
- [ ] **提交成功后**已将请求体 + 响应写入 `C:\work\parent-task-records\`（或用户指定目录），并**记住 `saved_path`**
- [ ] 需查测试环境日志时，优先 `POST /api/ssh/exec`，入参仅 `command` + `targetHost`（默认见 [§8.3](#83-默认命令按业务域)）

---

## 11. 与类型 4 的边界

| 场景 | 应用本文 | 说明 |
|------|:--------:|------|
| 开发自测 / 自 Review / 功能测试 | ✅ | `dev-agent` 页面或 API 直接提交 |
| Wiki 拆分故事 / 业务 Agent | ❌ | `task_type = 4`，走 Wiki Agent 页面，规则不同 |

---

## 12. 相关源码

| 文件 | 作用 |
|------|------|
| [`src/validation/parentTaskCreateZod.ts`](../src/validation/parentTaskCreateZod.ts) | 请求体 Zod 校验 |
| [`src/constants/parentAgentType.ts`](../src/constants/parentAgentType.ts) | 父任务类型 1/2/3/4 定义 |
| [`src/services/create/task/devParentTaskCreateStrategy.ts`](../src/services/create/task/devParentTaskCreateStrategy.ts) | 各类型子任务流水线 |
| [`src/routes/parentTask.ts`](../src/routes/parentTask.ts) | HTTP 路由实现 |
| [`src/routes/sshExec.ts`](../src/routes/sshExec.ts) | SSH 远程命令 `/api/ssh/exec` |
| [`src/services/tools/sshClient.ts`](../src/services/tools/sshClient.ts) | 堡垒机穿透与 shell 执行 |
