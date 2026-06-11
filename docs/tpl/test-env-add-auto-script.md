# QA 平台新增自动化测试脚本 AI 使用说明

面向 AI Agent，通过 MCP 工具 **`user-mcp-howbuy-remote`** 在 QA 平台新增自动化测试案例。

**当前 scriptId：** `{{scriptId}}`  
**当前测试环境 itNum：** `{{testEnv}}`

---

## MCP 工具概览

| 工具 | 用途 |
|---|---|
| `list_auto_test_script` | 查询 scriptId 下已有案例 |
| `add_auto_test_script` | 新增一条自动化案例 |
| `get_datasource_info` | 获取测试环境库连接 |
| `execute_sql_for_mysql` / `execute_sql_for_oracle` | 查数填充入参与断言 |

---

## 1. 查询已有案例（必做）

调用 **`list_auto_test_script`**：

| 参数 | 值 |
|---|---|
| `scriptId` | `{{scriptId}}` |

整理已有案例的 `title`、`input`、`expect`、标签，**避免重复新增**。

本地 Wiki 同步目录 `自动化测试案例/` 可作参考，**以 MCP 实时数据为准**。

---

## 2. 测试环境查数（新增案例前建议）

1. **`get_datasource_info`**，`itNum` = `{{testEnv}}`
2. 只读 SQL 获取客户号、产品代码、交易账号等**真实可用**测试数据
3. 查不到时说明数据缺口，或设计 `dataOperationPOList` 数据准备步骤

---

## 3. 新增案例

调用 **`add_auto_test_script`**：

| 参数 | 说明 |
|---|---|
| `requestBody` | **完整请求体的 JSON 字符串**（见下方结构） |

### requestBody 结构要点

```json
{
  "scriptCaseVo": {
    "title": "案例标题",
    "describe": "案例描述",
    "input": "{\"field1\":\"value1\",\"class\":\"com.example.Request\"}",
    "expect": "{\"returnCode\":\"0000000\"}",
    "scriptId": {{scriptId}},
    "order": 1,
    "labelIds": [93]
  },
  "scriptCaseAssertVOS": [],
  "dataOperationPOList": [],
  "labelIds": [93]
}
```

**格式约束：**

- `scriptCaseVo.input` / `expect` 必须是**字符串类型的 JSON**（转义后），不是嵌套对象
- `scriptCaseVo.scriptId` 固定为 `{{scriptId}}`
- `input` 中 Dubbo/Facade 类请求常含 `"class": "<Request全类名>"`
- 断言 `appName`、字段名与已有同 scriptId 案例保持一致
- 参考 Wiki `自动化测试案例/` 下 JSON 的 `data.list[]` 结构

---

## AI 工作流

1. **`list_auto_test_script`**（scriptId = `{{scriptId}}`）→ 已有覆盖清单
2. 理解用户本次要补充的**业务场景**（对话正文 + Wiki 需求）
3. **`get_datasource_info`** + SQL → 准备入参/断言数据
4. 组装 `requestBody`，调用 **`add_auto_test_script`**
5. 反馈 MCP 返回（成功 / 失败原因）；失败则修正后重试

可选：用 **`invoke_dubbo_interface`** / **`invoke_http_interface`** 在 `{{testEnv}}` **只读探测**接口行为后再写 expect。

---

## 约束

- ✅ 每条新案例对应明确业务场景，不与已有案例重复
- ✅ `requestBody` 合法 JSON，无双引号外单引号、无尾逗号
- ❌ 禁止修改被测系统业务源码
- ❌ 禁止编造 scriptId、表名、字段值
- ❌ 禁止在输出中泄露数据库密码

---

## 常见错误

| 现象 | 处理 |
|---|---|
| MCP 返回失败 | 检查 JSON 语法；`input`/`expect` 是否为字符串 |
| scriptId 不存在 | 向用户确认 scriptId |
| 断言不通过 | 用 SQL 核对 expect 字段；参考已有案例 assertType |
| 入参缺测试数据 | 先查库或标注需数据准备 |
