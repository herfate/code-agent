# 测试环境数据库连接 AI 使用说明

面向 AI Agent，通过 MCP 工具 **`user-mcp-howbuy-remote`** 连接测试环境数据库并执行只读查询。

**当前测试环境 itNum：** `{{testEnv}}`
**代码：** 当前目录下的项目

---

## 第一步：获取连接信息

调用 **`get_datasource_info`**：

| 参数 | 值 |
|---|---|
| `itNum` | `{{testEnv}}` |

返回中包含 MySQL / Oracle 等库的 `url`、`user`、`password`（**勿在对话中明文回显密码**）。

---

## 第二步：按库类型选用工具

### MySQL

| 工具 | 用途 |
|---|---|
| `list_table_for_mysql` | 列出所有表 |
| `describe_for_mysql` | 查看单表结构 |
| `execute_sql_for_mysql` | 执行 SELECT 或 DML |

参数：`mysql_url`、`mysql_user`、`mysql_password`、`sql`（或 `tableName`）

### Oracle

| 工具 | 用途 |
|---|---|
| `list_table_for_oracle` | 列出所有表 |
| `describe_for_oracle` | 查看单表结构 |
| `execute_sql_for_oracle` | 执行 SELECT 或 DML |

参数：`oracle_url`、`oracle_user`、`oracle_password`、`sql`（或 `tableName`）

---

## AI 工作流

1. **`get_datasource_info`**（`itNum` = `{{testEnv}}`）→ 选定目标库。
2. 不确定表名时先 **`list_table_*`**，再 **`describe_*`** 确认字段。
3. 编写 **SELECT** 查询；结果用于构造 Dubbo/HTTP 入参、自动化断言或问题排查。
4. 汇总查询结论（关键字段值、行数），**不输出**连接密码。

---

## 约束

- ✅ 默认**只读**（SELECT）；INSERT/UPDATE/DELETE 须用户明确要求且说明影响范围
- ✅ 大表查询加 `WHERE` / `ROWNUM` / `LIMIT` 限制行数
- ❌ 禁止编造表名、字段名（须先 describe 或查 Wiki）
- ❌ 禁止在日志、Markdown 中泄露 `mysql_password` / `oracle_password`

---

## 常见场景

| 场景 | 建议 |
|---|---|
| 构造自动化案例入参 | 查客户号、产品代码、交易账号等真实测试数据 |
| 验证接口落库 | 调用接口前后各查一次关键表 |
| 排查 Dubbo 失败 | 查申请单、确认单、份额等业务表状态 |

## 常见错误

| 现象 | 处理 |
|---|---|
| 连接失败 | 确认 `itNum` 正确；环境是否已日初始化 |
| 表不存在 | `list_table_*` 核对 schema；注意大小写 |
| 查无数据 | 放宽条件或换测试客户；标注「需数据准备」 |
