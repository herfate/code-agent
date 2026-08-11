# 代码规范抽取 — 参考

供 `extract-code-style` 在需要细节时阅读；不要整份塞进默认上下文。

## 八类约定（对齐 skillgen）

### naming

文件名、目录名、类型/函数/变量/常量、DB 列、枚举值。记录大小写风格与常见后缀（如 `*Service`、`*Handler`）。

### error-handling

抛错 vs 返回 Result；错误码/异常层次；边界是否吞错；日志+抛出的组合方式。

### testing

测试目录位置、命名（`*.test.ts` / `*_test.go`）、断言库、fixture/mock 习惯、是否测私有实现。

### imports

绝对 vs 相对；分组与排序；禁止的深层相对路径；路径别名（`@/` 等）。

### documentation

注释语言（中/英）、JSDoc/JavaDoc 密度、何时必须写「为什么」、README 角色。

### architecture

分层（routes → services → db）、新代码应落在哪、禁止跨层调用、模块边界。

### formatting-and-style

行宽、引号、分号、trailing comma、formatter 是否权威（以配置文件为准，勿与 Prettier/ESLint 冲突的「习惯」抢优先级）。

### logging

日志库、logger 获取方式、结构化字段、级别约定、禁止打密钥。

## 证据门槛

| confidence | 条件 |
|------------|------|
| high | 配置文件明确，或 ≥3 处一致用法 |
| medium | 2 处一致，或配置与代码略有出入 |
| low | 仅 1 处或信号冲突；正文须标明不确定性 |

优先引用**规范配置**（eslint rules、editorconfig）再辅以代码样例。配置与代码冲突时：写清冲突，PREFERRED 跟随占多数的实际代码，并注明配置期望。

## 规则写法

```markdown
### ALWAYS
- Use `camelCase` for functions and local variables.

### NEVER
- Do not use `var`; use `const` / `let`.

### PREFERRED
- Prefer early return over deep nesting in route handlers.
```

每条下附 **1 个**短代码摘录（来自本仓库），并在 frontmatter `evidence` 列路径。

## 正文标题

- 一级标题固定为 `# 简述`，后接一两句概括；**不要**用 `# 命名约定` 等与 frontmatter `title` 重复的标题

## 反模式

- 把通用语言最佳实践整页抄入（Agent 已知）；只写**本仓库特有**或**与默认不同**的约定
- 把偶发坏味道写成 ALWAYS
- 单文件塞多类（应拆到上表 id）
- 覆盖已有文件而未获用户 regenerate 授权

## 与 Cursor rules / AGENTS.md

本 skill **不**自动写入 `.cursor/rules` 或根 `AGENTS.md`。若用户另行要求同步为 rules，再另开任务。
