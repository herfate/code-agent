# 业务核心抽取 — 参考

供 `extract-business-core` 在需要细节时阅读。

## 三阶段（对齐 codebase-knowledge-builder）

### Recon

| 关注点 | 做法 |
|--------|------|
| 技术栈与入口 | 读 README、主 module、路由注册、定时任务列表 |
| 模块边界 | 按目录/包名切分；识别 anti-corruption 或 facade |
| 领域名词 | 从包名、表名、枚举、注释收集；避免自创术语 |
| 集成面 | HTTP、Dubbo/RPC、MQ、DB、外部文件（如清算文件编号） |

输出：拟建文档 id 列表 + 每条一句话职责。

### Deep-dive

对单个 id：

1. 从入口符号追到持久化或出站调用（Grep/Read，控制跳数）
2. 画主路径（文字步骤或 Mermaid `sequenceDiagram` / `flowchart`）
3. 找校验、状态流转、错误码
4. 记录「坑点」：仅来自注释、FIXME、明显特殊分支；禁止臆测生产事故

### Artifact

每文件建议章节（可删无内容节，勿留空洞占位）：

1. 职责与边界（做什么 / 不做什么）
2. 领域概念（本子系统内）
3. 主流程
4. 失败与边界
5. 关键接口 / 表 / 消息
6. 坑点与注意事项
7. （可选）流程图

## 子系统切分启发式

- 按**业务能力**切，不按技术层切（避免 `controllers.md`、`dao.md` 这种无业务信息文件）
- 过大模块（如「清算全部」）拆到用例级：`settle-subscription-020`、`settle-redeem-024`
- 共享内核可单独一篇 `shared-<name>`，并在各用例文中链接

## Mermaid 注意

- 节点 ID 用 camelCase；标签特殊字符用引号
- 不写 `style` / `click`（渲染兼容性）

## 证据与 confidence

| confidence | 条件 |
|------------|------|
| high | 主路径可从入口跟到落库/出站，证据 ≥3 |
| medium | 主路径清楚但分支不全 |
| low | 仅目录/命名推断，或大量「未在代码中定位」 |

## 反模式

- 复制 Wiki/需求全文却不对照代码
- 把代码风格写入 business-core（应走 `extract-code-style`）
- 单文件超长（宜拆 id）
- 覆盖 `accepted` 未获 regenerate 授权
- 把猜测写成确定不变量

## 与知识沉淀任务

本 skill 独立于平台「知识沉淀」父任务（类型 7 / task 13）。不修改 `prompt_tpl`；若需对接流水线，另开需求。
