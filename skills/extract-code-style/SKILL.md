---
name: extract-code-style
description: >-
  Analyze a codebase and extract coding conventions into one Markdown file per
  category under knowledge_base/code-style/. Use when the user asks to extract
  code style, coding conventions, project standards, naming/error-handling/
  testing patterns, or to refresh knowledge_base INDEX for code-style entries.
---

# 代码规范抽取

从当前工作区（或用户指定的仓库根）抽取**已有**约定，写入 `knowledge_base/code-style/`。一类一文件。

详细门槛与类别说明见 [reference.md](reference.md)。单文件骨架见 [templates/item.md](templates/item.md)。

## 何时使用

- 用户要求抽取/更新代码规范、风格指南、项目约定
- 用户要求刷新 `knowledge_base/INDEX.md`（含 code-style 条目）

## 输出位置

- 规范文件：`knowledge_base/code-style/<id>.md`
- 总索引：`knowledge_base/INDEX.md`（与 business-core 条目合并维护）
- 目录约定：`knowledge_base/README.md`

若不存在 `knowledge_base/`，先按 README 约定创建目录骨架。

## 标准类别（一类一文件）

| id | 文件 |
|----|------|
| naming | `naming.md` |
| error-handling | `error-handling.md` |
| testing | `testing.md` |
| imports | `imports.md` |
| documentation | `documentation.md` |
| architecture | `architecture.md` |
| formatting-and-style | `formatting-and-style.md` |
| logging | `logging.md` |

证据不足的类别：仍可写文件，但 `confidence: low`，并在正文说明「样本不足」。不要臆造仓库里不存在的规范。

## 流程

1. **侦察**
   - 语言/框架（package.json、go.mod、pom.xml、Cargo.toml 等）
   - 格式化与 lint 配置（eslint、prettier、checkstyle、editorconfig 等）
   - 目录分层与典型入口

2. **分面抽取**
   - 对上表每一类，用 Glob/Grep/Read 找真实代码
   - 每类至少 **2–3 处**证据路径写入 frontmatter `evidence`
   - 规则写成祈使句，分 **ALWAYS / NEVER / PREFERRED**
   - 禁止空泛句（如「写干净代码」）；每条规则要可执行、可对照代码

3. **落盘**
   - 用 [templates/item.md](templates/item.md) 写/更新 `knowledge_base/code-style/<id>.md`
   - 正文一级标题固定为 **`# 简述`**，下接一两句要点（不要写成 `# 命名约定` 这类与 title 重复的标题）
   - `status` 默认 `candidate`；`updated` 用当天日期（YYYY-MM-DD）
   - 已存在文件：默认不覆盖（除非用户明确要求 regenerate）

4. **刷新 INDEX**
   - 扫描 `knowledge_base/code-style/*.md` 与 `knowledge_base/business-core/*.md` 的 frontmatter
   - 重写 `knowledge_base/INDEX.md` 表格（列：id、title、category、status、path）

5. **收尾**
   - 向用户列出本次写入/更新的文件路径

## 仅刷新 INDEX

若用户只要刷新索引：只扫描现有 md、重写 `INDEX.md`，不重新抽取。

## 质量检查

- [ ] 每份文件有完整 frontmatter（含 category: code-style）
- [ ] 正文以 `# 简述` 开头，且简述非空
- [ ] 规则为祈使句，含 ALWAYS/NEVER/PREFERRED 至少一类
- [ ] evidence 指向真实相对路径
- [ ] 未擅自覆盖已有文件（除非用户要求 regenerate）
- [ ] INDEX 与磁盘文件一致
