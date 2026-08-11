---
name: extract-business-core
description: >-
  Study a codebase and extract business-core knowledge into one Markdown file
  per subsystem or use-case under knowledge_base/business-core/. Use when the
  user asks for business documentation, domain knowledge, architecture of a
  subsystem, core flows, or to refresh knowledge_base INDEX for business-core
  entries.
---

# 业务核心抽取

从当前工作区（或用户指定的仓库根）抽取**业务核心**知识，按子系统或核心用例拆成独立 Markdown，写入 `knowledge_base/business-core/`。用户通过 frontmatter `status` 选用。

方法论细节见 [reference.md](reference.md)。单文件骨架见 [templates/item.md](templates/item.md)。

## 何时使用

- 用户要求抽取业务知识、领域文档、子系统说明、核心流程
- 用户要求刷新 `knowledge_base/INDEX.md`（含 business-core 条目）

## 输出位置

- 知识文件：`knowledge_base/business-core/<id>.md`（`id` 为 kebab-case，如 `order-settle`、`fund-redeem-024`）
- 总索引：`knowledge_base/INDEX.md`（与 code-style 条目合并维护）
- 目录约定：`knowledge_base/README.md`

若不存在 `knowledge_base/`，先按 README 约定创建目录骨架。

## 切分原则

- **一文件 = 一个子系统或一个核心用例**；宁可多文件、短篇幅
- 不要把整仓塞进单份「上帝文档」
- 文件名与 frontmatter `id` 一致；`category: business-core`

## 流程

### 1. Recon（侦察）

- 入口（HTTP/RPC/消息/批任务）、模块边界、目录地图
- 领域名词表（中英对照若可得）
- 关键表 / 消息 / API 列表（只列真正核心的）

将 recon 结论用于决定要产出哪些 `<id>.md`；可先在回复中列出拟建清单，再深挖（用户已指定范围则按其范围）。

### 2. Deep-dive（按条目深挖）

对每个拟建 id：

- Happy path：主成功路径（谁调用谁、关键状态）
- 失败 / 边界：校验失败、重试、幂等、对账不平（若代码可见）
- 不变量：金额/份额/状态机等业务约束（有证据再写）

### 3. Artifact（成文落盘）

- 用 [templates/item.md](templates/item.md) 写入 `knowledge_base/business-core/<id>.md`
- 含：职责、主流程、关键类型/表/接口、坑点、可选 Mermaid
- `status` 默认 `candidate`；`updated` 用当天日期（YYYY-MM-DD）
- frontmatter `evidence` 至少 2 个真实相对路径
- **已存在且 `status: accepted`：默认不覆盖**（除非用户明确要求 regenerate）
- `rejected`：不擅自改为 `accepted`

### 4. 刷新 INDEX

- 扫描 `knowledge_base/code-style/*.md` 与 `knowledge_base/business-core/*.md`
- 重写 `knowledge_base/INDEX.md`

### 5. 收尾

- 列出候选文件，请用户将要保留的改为 `accepted`，不要的改为 `rejected` 或删除
- 提醒：仅 `accepted` 视为生效业务知识

## 仅刷新 INDEX

若用户只要刷新索引：只扫描现有 md、重写 `INDEX.md`，不重新抽取。

## 质量检查

- [ ] 每文件聚焦单一子系统/用例
- [ ] frontmatter 完整（category: business-core）
- [ ] 有主流程与至少一处失败/边界说明（代码不可见则标明「未在代码中定位」）
- [ ] evidence 真实；可选 Mermaid 语法合法
- [ ] 未覆盖未授权的 `accepted` 文件
- [ ] INDEX 与磁盘一致
