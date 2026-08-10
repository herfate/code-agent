# trade-mock Mock 接口 AI 使用说明

面向 AI Agent，用于配置 Dubbo Provider Mock 数据。

**基础地址：** `http://trade-mock.{{testEnv]}.k8s.howbuy.com/api/trade`
***其中的{{testEnv]}请确认为实际测试环境***
---

## 通用约定

- 参数用 **Query String 或 form-urlencoded**，**不要用 JSON Body**
- 唯一键：`(interfaceClass, methodName)`，重复保存为更新
- 返回值支持两种模式：
    - **静态 JSON**：`retValue` 固定返回
    - **Groovy 动态脚本**：`script` 非空时**优先于** `retValue` 执行，可按入参动态构造返回值

---

## 1. 查询 Mock 列表

```
GET /api/trade/selectMockPageList
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `pageNo` | 否 | 默认 1 |
| `pageSize` | 否 | 默认 10 |
| `interfaceClass` | 否 | 接口全限定名 |
| `methodName` | 否 | 方法名 |
| `status` | 否 | `1` 启用 / `0` 禁用 |

**响应：** `{ totalCount, pageNo, pageSize, totalPage, data: [...] }`

---

## 2. 保存 Mock

```
POST /api/trade/saveMock
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `interfaceClass` | 是 | Dubbo 接口全限定名 |
| `methodName` | 是 | 如 `execute` |
| `retType` | 是 | 返回类型；支持裸类名或泛型表达式（见 §4） |
| `innerRetType` | 否 | 内层类型；支持裸类名或泛型表达式（见 §4） |
| `retValue` | 二选一 | JSON **对象**字符串（顶层必须是 `{...}`，不能是数组） |
| `script` | 二选一 | Groovy；非空时优先执行 |

- `retValue` 与 `script` **至少填一个**
- 自动 `status=1` 并动态暴露 Dubbo
- 成功 `{ "code": 0 }`；失败 `{ "code": -1 }`
- 启停：`POST /api/trade/changeStatus`，传目标 `status`（`1` 暴露 / `0` 销毁）

---

## 3. 一层嵌套（历史用法）

适用于：`XxxResponse` 内直接挂 `List<Vo>` / 单个 Vo，**无外层泛型包装**。

| 字段 | 示例 |
|---|---|
| `retType` | `...QueryBatchStatusResponse` |
| `innerRetType` | `...BatchStatusVo`（简单类名，无 `<>`） |

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

## 4. 多层泛型（重点）

适用于：`BaseResponse<PageData<Record>>`、`BaseResponse<List<Record>>` 等。

仅配 `retType=BaseResponse` + 裸 `Class` 反序列化时，`data` 会落成 `JSONObject`/`HashMap`，消费端强转 `PageData` 必挂。必须把**完整泛型信息**配进 `retType` / `innerRetType`。

### 4.1 配置方式（二选一）

**方式 A（推荐）：外层 + 内层表达式**

| 字段 | 写法 |
|---|---|
| `retType` | 外层裸类，如 `com.howbuy.otc.BaseResponse` |
| `innerRetType` | 含 `<>` 的内层，如 `com.howbuy.otc.PageData<...FundMerchantInfoRecord>` |

**方式 B：`retType` 写完整表达式**

```
retType = com.howbuy.otc.BaseResponse<com.howbuy.otc.PageData<...FundMerchantInfoRecord>>
innerRetType = （可空）
```

### 4.2 选型对照

| 返回签名 | retType | innerRetType |
|---|---|---|
| `XxxResponse` + `List<Vo>` | `XxxResponse` | `Vo` |
| `BaseResponse<PageData<R>>` | `com.howbuy.otc.BaseResponse` | `com.howbuy.otc.PageData<R的FQCN>` |
| `BaseResponse<List<R>>` | `com.howbuy.otc.BaseResponse` | `java.util.List<R的FQCN>` |

### 4.3 包名必须与真实 jar 一致

资金账户查询（`otc-common-api` / `otc-center-search-client`）正确类型：

| 类型 | 正确 FQCN |
|---|---|
| 响应包装 | `com.howbuy.otc.BaseResponse` |
| 分页 | `com.howbuy.otc.PageData` |
| 商户 Facade | `com.howbuy.otc.search.facade.fund.querymerchantinfo.QueryFundMerchantInfoFacade` |
| 商户 Record | `...querymerchantinfo.FundMerchantInfoRecord` |

错误示例（会导致 HashMap / JSONObject 强转失败）：

- ~~`com.howbuy.otc.search.facade.base.BaseResponse`~~
- ~~`com.howbuy.otc.search.facade.base.PageData`~~

优先让 mock 工程依赖真实 facade jar；有真实类则复用，无则按 JSON 动态生成（FQCN 仍须与消费端一致）。

### 4.4 完整示例：商户分页 `BaseResponse<PageData<Record>>`

```
interfaceClass = com.howbuy.otc.search.facade.fund.querymerchantinfo.QueryFundMerchantInfoFacade
methodName     = execute
retType        = com.howbuy.otc.BaseResponse
innerRetType   = com.howbuy.otc.PageData<com.howbuy.otc.search.facade.fund.querymerchantinfo.FundMerchantInfoRecord>
```

```json
{
  "returnCode": "F0000000",
  "description": "成功",
  "data": {
    "pageNum": 1,
    "pageSize": 20,
    "total": 1,
    "totalPage": 1,
    "list": [
      {
        "coopMerchantId": "1600043536",
        "coopMerchantName": "招银理财"
      }
    ]
  }
}
```

批量列表（`BaseResponse<List<R>>`）时：`innerRetType=java.util.List<R的FQCN>`，且 `retValue.data` 为**数组**。


### 4.5 配置检查清单

1. Facade / Record / `BaseResponse` / `PageData` FQCN 与消费端 jar **完全一致**
2. 多层场景 `innerRetType`（或 `retType`）必须带 `<>`，不能只写外层裸类
3. `retValue` 顶层是对象；分页时 `data` 为对象，批量列表时 `data` 为数组
4. 改完配置后若曾用错误类型暴露过，需 **重启** 或先 `status=0` 再 `status=1` 重新暴露

---

## 5. Groovy 动态脚本

按入参动态返回时用 `script` 代替固定 `retValue`。

| 项 | 说明 |
|---|---|
| 优先级 | `script` 非空 → Groovy；否则解析 `retValue` |
| 返回值 | 脚本最后表达式 |
| 类型转换 | 按 `retType`+`innerRetType` 的泛型 Type 反序列化（多层同样生效） |
| 内置变量 | `request`、`args`、`mockPo`、`spring`、`JSON`、`log` |

```groovy
def fundId = request?.fundId ?: "demoData"
if (fundId == "FAIL") {
    return [returnCode: "9999999", batchStatusList: []]
}
return [returnCode: "0000000", batchStatusList: [[fundId: fundId, status: "11"]]]
```

多层场景也可返回 `Map`，但须保证 `retType`/`innerRetType` 泛型配置正确，否则 `data` 仍可能是 Map。

---

## 6. PowerShell 示例

**一层嵌套：**

```powershell
$body = @{
    interfaceClass = "com.howbuy.payonline.facade.query.batchstatus.QueryBatchStatusFacade"
    methodName = "execute"
    retType = "com.howbuy.payonline.facade.query.batchstatus.QueryBatchStatusResponse"
    innerRetType = "com.howbuy.payonline.facade.query.batchstatus.BatchStatusVo"
    retValue = '{"returnCode":"0000000","batchStatusList":[{"fundId":"demoData","status":"11"}]}'
}
Invoke-RestMethod -Uri "http://trade-mock.{{testEnv]}.k8s.howbuy.com/api/trade/saveMock" -Method Post -Body $body
```

**多层泛型（商户分页）：**

```powershell
$body = @{
    interfaceClass = "com.howbuy.otc.search.facade.fund.querymerchantinfo.QueryFundMerchantInfoFacade"
    methodName = "execute"
    retType = "com.howbuy.otc.BaseResponse"
    innerRetType = "com.howbuy.otc.PageData<com.howbuy.otc.search.facade.fund.querymerchantinfo.FundMerchantInfoRecord>"
    retValue = '{"returnCode":"F0000000","description":"成功","data":{"pageNum":1,"pageSize":20,"total":1,"totalPage":1,"list":[{"coopMerchantId":"1600043536","coopMerchantName":"招银理财"}]}}'
}
Invoke-RestMethod -Uri "http://trade-mock.{{testEnv]}.k8s.howbuy.com/api/trade/saveMock" -Method Post -Body $body
```

**启停：**

```powershell
# 启用并暴露
Invoke-RestMethod -Uri "http://trade-mock.{{testEnv]}.k8s.howbuy.com/api/trade/changeStatus" -Method Post -Body @{
    interfaceClass = "com.howbuy.otc.search.facade.fund.querymerchantinfo.QueryFundMerchantInfoFacade"
    methodName = "execute"
    status = "1"
}
# 禁用并销毁暴露
Invoke-RestMethod -Uri "http://trade-mock.{{testEnv]}.k8s.howbuy.com/api/trade/changeStatus" -Method Post -Body @{
    interfaceClass = "com.howbuy.otc.search.facade.fund.querymerchantinfo.QueryFundMerchantInfoFacade"
    methodName = "execute"
    status = "0"
}
```

---

## 7. AI 工作流

1. `selectMockPageList` 查是否已有记录
2. 看返回签名选模式：
    - 一层 `Response`+`Vo` → §3
    - `BaseResponse<PageData<T>>` / `BaseResponse<List<T>>` → §4（必须配泛型表达式）
    - 需按入参分支 → §5 Groovy
3. **核对 FQCN**（尤其 `com.howbuy.otc.BaseResponse` / `PageData`）
4. `saveMock`（`retValue` 与 `script` 二选一）
5. `code === 0` 后查询验证；消费端验证勿出现 `HashMap`/`JSONObject` 强转失败

---

## 8. 常见错误

| 现象 | 处理 |
|---|---|
| `HashMap` / `JSONObject` cannot cast to `PageData` | 补全多层泛型配置；核对 `PageData`/`BaseResponse` 包名 |
| `JSONObject` cannot cast to `BaseResponse` | `retType` 错误或未按泛型解析；改正确 FQCN 后重启/重新暴露 |
| `code: -1` | 检查字段长度（`retValue` 最大约 3000） |
| 400 / 参数无效 | 勿用 JSON Body |
| retValue 解析失败 | 顶层必须是 `{...}` |
| `未配置返回值或Groovy脚本` | `retValue` 与 `script` 至少填一个 |
| 关闭开关却在暴露 / 开启却销毁 | 前端以 Switch 目标状态传 `status`；后端 `1`=暴露、`0`=销毁 |
| 改配置后类型仍错 | 重启，或 `changeStatus` 先 `0` 再 `1` |

## 9. 样例

### param-server
```
 (INTERFACE_CLASS, METHOD_NAME, RET_VALUE, RET_TYPE, INNER_RET_TYPE, STATUS, script) VALUES ('com.howbuy.paramcenter.serverfacade.tradeday.QueryTradeDtFacade', 'execute', '{"success":true,"retCode":"000000","retMsg":"成功","data":"20260723"}', 'com.howbuy.paramcenter.vo.Result<java.lang.String>', 'java.lang.String', '1', 'import java.text.SimpleDateFormat
import java.util.Calendar
def baseDt = request?.baseDt ?? "20260722"
def interval = request?.interval ?? 1
def sdf = new SimpleDateFormat("yyyyMMdd")
def cal = Calendar.getInstance()
cal.setTime(sdf.parse(baseDt))
int step = interval > 0 ? 1 : (interval < 0 ? -1 : 0)
int remaining = Math.abs(interval)
while (remaining > 0) {
cal.add(Calendar.DAY_OF_MONTH, step)
int dow = cal.get(Calendar.DAY_OF_WEEK)
if (dow != Calendar.SATURDAY && dow != Calendar.SUNDAY) {
remaining--
}
}
def result = sdf.format(cal.getTime())
return [retCode: "000000", retMsg: "成功", data: result]');
```
