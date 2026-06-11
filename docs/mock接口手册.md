# trade-mock Mock 接口 AI 使用说明

面向 AI Agent，用于配置 Dubbo Provider Mock 数据。

**基础地址：** `http://trade-mock.it01.k8s.howbuy.com/api/trade`
***it01请替换为实际环境***
---

## 通用约定

- 参数用 **Query String 或 form-urlencoded**，**不要用 JSON Body**
- 唯一键：`(interfaceClass, methodName)`，重复保存为更新
- 样例数据：`docs/mysql.dml.sql`
- 返回值支持两种模式：
    - **静态 JSON**：`retValue` 固定返回
    - **Groovy 动态脚本**：`script` 非空时**优先于** `retValue` 执行，可按入参动态构造返回值

---

## 1. 查询 Mock 列表

```
GET http://trade-mock.it01.k8s.howbuy.com/api/trade/selectMockPageList
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `pageNo` | 否 | 页码，默认 1 |
| `pageSize` | 否 | 每页条数，默认 10 |
| `interfaceClass` | 否 | 接口全限定名 |
| `methodName` | 否 | 方法名 |
| `status` | 否 | `1` 启用 / `0` 禁用 |

**响应：** `{ totalCount, pageNo, pageSize, totalPage, data: [...] }`

---

## 2. 保存 Mock

```
POST http://trade-mock.it01.k8s.howbuy.com/api/trade/saveMock
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `interfaceClass` | 是 | Dubbo 接口全限定名 |
| `methodName` | 是 | 方法名，如 `execute` |
| `retType` | 是 | 返回值 Java 全类名 |
| `retValue` | 二选一 | JSON **对象**字符串（非数组）；配置 `script` 时可留空 |
| `script` | 二选一 | Groovy 脚本；非空时优先执行，忽略 `retValue` |
| `innerRetType` | 否 | 嵌套对象/列表元素类型全类名 |

- `retValue` 与 `script` **至少填一个**，否则 Dubbo 调用会报错
- 自动设置 `status=1` 并动态暴露 Dubbo 服务
- 成功：`{ "code": 0 }`；失败：`{ "code": -1 }`
- 禁用 Mock 用 `POST .../changeStatus`，传 `status=0`

**retValue 示例（静态 JSON）：**

```json
{
  "returnCode": "0000000",
  "batchStatusList": [{
    "fundId": "demoData",
    "status": "11"
  }]
}
```

---

## 3. Groovy 动态脚本（script）

当需要根据**入参**动态返回不同结果时，使用 `script` 代替固定 `retValue`。

### 执行规则

| 项 | 说明 |
|---|---|
| 优先级 | `script` 非空 → 执行 Groovy；否则解析 `retValue` |
| 返回值 | 脚本最后一行表达式的值即为返回值 |
| 类型转换 | 自动转为 `retType`：已是目标类型则直接返回；`Map`/`List`/JSON 字符串会反序列化为 POJO |
| 热更新 | 脚本内容变更后按 MD5 自动重新编译，无需重启 |

### 脚本内置变量

常用：`request`（首参）、`args`（全部入参）、`mockPo`（当前配置）、`spring`、`JSON`、`log`

### script 示例

```groovy
def fundId = request?.fundId ?: "demoData"
if (fundId == "FAIL") {
    return [returnCode: "9999999", batchStatusList: []]
}
return [returnCode: "0000000", batchStatusList: [[fundId: fundId, status: "11"]]]
```

> 返回 `Map` 或 JSON 字符串均可，会自动转为 `retType` 对应 POJO。

---

## Windows 调用示例（PowerShell）

**查询：**

```powershell
Invoke-RestMethod -Uri "http://trade-mock.it01.k8s.howbuy.com/api/trade/selectMockPageList" `
  -Method Get -Body @{ pageNo=1; pageSize=10; status="1" } | ConvertTo-Json -Depth 10
```

**保存：**

```powershell
$body = @{
    interfaceClass = "com.howbuy.payonline.facade.query.batchstatus.QueryBatchStatusFacade"
    methodName = "execute"
    retType = "com.howbuy.payonline.facade.query.batchstatus.QueryBatchStatusResponse"
    innerRetType = "com.howbuy.payonline.facade.query.batchstatus.BatchStatusVo"
    retValue = '{"returnCode":"0000000","batchStatusList":[{"fundId":"demoData","status":"11"}]}'
}
Invoke-RestMethod -Uri "http://trade-mock.it01.k8s.howbuy.com/api/trade/saveMock" -Method Post -Body $body
```

**保存（Groovy 动态脚本）：**

```powershell
$body = @{
    interfaceClass = "com.howbuy.payonline.facade.query.batchstatus.QueryBatchStatusFacade"
    methodName = "execute"
    retType = "com.howbuy.payonline.facade.query.batchstatus.QueryBatchStatusResponse"
    innerRetType = "com.howbuy.payonline.facade.query.batchstatus.BatchStatusVo"
    script = 'def fundId = request?.fundId ?: "demoData"; return [returnCode: "0000000", batchStatusList: [[fundId: fundId, status: "11"]]]'
}
Invoke-RestMethod -Uri "http://trade-mock.it01.k8s.howbuy.com/api/trade/saveMock" -Method Post -Body $body
```

---

## AI 工作流

1. `selectMockPageList` 查是否已有记录
2. 选择模式：
    - **固定返回** → 构造 `retValue`（合法 JSON 对象）
    - **动态返回** → 编写 `script`（Groovy），利用 `request`/`args` 读取入参
3. 调用 `saveMock`（`retType` 必填；`retValue` 与 `script` 二选一）
4. 确认 `code === 0`，再查询验证

## 常见错误

| 现象 | 处理 |
|---|---|
| `code: -1` | 检查字段长度（`retValue` 最大 3000 字符） |
| 400 / 参数无效 | 勿用 JSON Body，改用 form/query |
| retValue 解析失败 | 必须是 `{...}` 对象，参考 `mysql.dml.sql` |
| `未配置返回值或Groovy脚本` | `retValue` 与 `script` 至少填一个 |
| `Groovy脚本执行失败` | 检查脚本语法；确认 `return` 的结构可转为 `retType` |
| 动态返回不符合预期 | 用 `log.info(...)` 打印 `request` 字段排查入参 |
