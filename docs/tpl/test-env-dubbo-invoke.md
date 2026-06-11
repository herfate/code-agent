# 测试环境 Dubbo 接口调用 AI 使用说明

面向 AI Agent，通过 MCP 工具 **`user-mcp-howbuy-remote`** 在测试环境调用 Dubbo 接口。

**当前测试环境 itNum：** `{{testEnv}}`

---

## MCP 工具：`invoke_dubbo_interface`

| 参数 | 必填 | 说明 |
|---|---|---|
| `itNum` | 是 | 测试环境，如 `it01`、`it116` |
| `interfaceName` | 是 | Dubbo 接口全限定名 |
| `requestClassFullName` | 是 | 请求参数 Java 全类名 |
| `methodName` | 是 | 方法名 |
| `requestJson` | 是 | 请求参数 JSON 字符串 |

---

## 调用示例

**场景：** 查询批次状态

```
itNum: {{testEnv}}
interfaceName: com.howbuy.payonline.facade.query.batchstatus.QueryBatchStatusFacade
requestClassFullName: com.howbuy.payonline.facade.query.batchstatus.QueryBatchStatusRequest
methodName: execute
requestJson: {"fundId":"demoData"}
```

---

## AI 工作流

1. 从用户描述或 Wiki/代码中确认 `interfaceName`、`requestClassFullName`、`methodName`。
2. 构造合法 `requestJson`（字段名与 Java 请求类一致；`input` 中常含 `"class": "<Request全类名>"` 可参考已有自动化案例）。
3. 调用 **`invoke_dubbo_interface`**，`itNum` = `{{testEnv}}`。
4. 解析返回：关注 `returnCode` / 业务字段；失败时结合 **`k8s_log`** 查应用日志排查。

---

## 辅助工具

| 工具 | 用途 |
|---|---|
| `k8s_pod` | 查看 `{{testEnv}}` 节点服务是否就绪 |
| `k8s_log` | 按 `serverName` 拉取最近 N 行日志 |
| `get_datasource_info` + SQL 工具 | 查数构造入参或校验落库结果 |

---

## 约束

- ✅ 优先**只读探测**；改数须用户明确要求
- ✅ `requestJson` 必须是合法 JSON 字符串
- ❌ 禁止在输出中泄露数据库密码或敏感 token
- ❌ 接口无 Mock 且依赖外部系统时，先说明风险再调用

## 常见错误

| 现象 | 处理 |
|---|---|
| 接口不存在 / 超时 | `k8s_pod` 确认服务；检查 `interfaceName` 拼写 |
| 反序列化失败 | 核对 `requestClassFullName` 与 `requestJson` 字段 |
| 业务 returnCode 非成功 | 用 SQL 查前置数据；或配置 Mock（见「测试环境mock dubbo接口」模板） |
