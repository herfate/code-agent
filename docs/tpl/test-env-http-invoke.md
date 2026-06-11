# 测试环境 HTTP 请求 AI 使用说明

面向 AI Agent，通过 MCP 工具 **`user-mcp-howbuy-remote`** 发起 HTTP 请求，用于联调、排查或验证测试环境接口。

**当前测试环境 itNum：** `{{testEnv}}`

---

## 环境 URL 约定

测试环境服务通常形如：

```
http://<应用名>.{{testEnv}}.k8s.howbuy.com/<路径>
```

示例：

- `http://fbs-online.{{testEnv}}.k8s.howbuy.com/fbs-online/...`
- `http://trade-mock.{{testEnv}}.k8s.howbuy.com/api/trade/...`

具体路径以 Wiki 接口文档或用户输入为准。

---

## MCP 工具：`invoke_http_interface`

| 参数 | 必填 | 说明 |
|---|---|---|
| `url` | 是 | 完整请求 URL |
| `requestMethod` | 是 | `GET` / `POST` / `PUT` 等；可空时默认 POST |
| `requestBody` | 是 | 请求体字符串；GET 无 body 时可传空字符串 `""` |

---

## 调用示例

**POST JSON：**

```
url: http://fbs-online.{{testEnv}}.k8s.howbuy.com/fbs-online/fund/subscribe
requestMethod: POST
requestBody: {"fundCode":"000001","amount":1000}
```

**GET：**

```
url: http://trade-mock.{{testEnv}}.k8s.howbuy.com/api/trade/selectMockPageList?pageNo=1&pageSize=10
requestMethod: GET
requestBody: ""
```

---

## AI 工作流

1. 从用户描述或 Wiki 确认 **URL、Method、Body**。
2. 将 `{{testEnv}}` 代入域名中的环境段。
3. 调用 **`invoke_http_interface`** 发送请求。
4. 解析响应状态码与 body；失败时用 **`k8s_log`** 查对应 `serverName` 日志。

---

## 辅助工具

| 工具 | 用途 |
|---|---|
| `k8s_pod` | 确认 `{{testEnv}}` 目标应用是否运行 |
| `k8s_log` | 拉取应用最近日志 |
| `get_datasource_info` + SQL | 校验 HTTP 调用后的落库结果 |

---

## 约束

- ✅ Body 为 JSON 时使用合法 JSON 字符串
- ✅ 写操作（POST 改数）须用户明确意图
- ❌ 勿将 Cookie、Token 等敏感头信息写入持久化输出
- ❌ trade-mock 等接口若要求 form-urlencoded，勿用 JSON Body（见 Mock 模板）

## 常见错误

| 现象 | 处理 |
|---|---|
| 404 / 502 | `k8s_pod` 查服务名；核对 URL 与应用是否部署 |
| 400 参数错误 | 对照 Wiki 接口文档修正 body 字段 |
| 超时 | 缩小请求范围或查日志是否有下游 Dubbo 阻塞 |
