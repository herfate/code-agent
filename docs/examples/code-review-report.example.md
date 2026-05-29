# Code Review 报告

| 字段 | 值 |
|------|-----|
| 父任务 PID | `10042` |
| 应用 | `order-service` |
| 分支 | `feature/TAPD-8842-order-cancel` |
| 对比基线 | `main` / MR `#1287` |
| 审查范围 | 本次 MR diff（42 个文件） |
| 设计文档版本 | 设计任务 ai_out/10042/0/design.md |
| 需求来源 | TAPD `884215` — 支持用户取消未支付订单 |
| 审查时间 | `2026-05-29T10:30:00+08:00` |
| 审查模型 | Cursor Agent |

---

## 审查摘要

> **结论（一句话）**：核心业务路径符合设计，但存在 1 项阻塞级幂等缺陷与 1 项 major 级输入校验问题，**不建议合并**。

```json
{
  "verdict": "request_changes",
  "verdict_label": "需修改",
  "merge_recommendation": false,
  "confidence": "high",
  "scope_coverage_percent": 92,
  "counts": {
    "blocker": 1,
    "major": 1,
    "minor": 3,
    "nit": 2,
    "info": 1
  },
  "business_risk_level": "medium",
  "code_quality_score": 74,
  "must_fix_before_merge": ["B-001", "C-002"],
  "summary_zh": "取消订单主流程与状态机基本一致；重复提交未做幂等可能导致重复退款；取消接口缺少金额上限校验。",
  "reviewed_files_count": 42,
  "out_of_scope_not_reviewed": ["**/generated/**", "package-lock.json"]
}
```

---

## 1. 业务与需求符合性

### 1.1 需求覆盖矩阵

| 需求 ID / 条目 | 设计/验收要点 | 实现证据 | 结论 | 备注 |
|----------------|---------------|----------|------|------|
| REQ-8842-01 | 仅「待支付」可取消 | `OrderCancelService.ts:45-52` | ✅ 符合 | |
| REQ-8842-02 | 取消后释放库存 | `InventoryClient.release` 调用 | ✅ 符合 | |
| REQ-8842-03 | 重复取消返回幂等成功 | 未实现幂等键 | ❌ 不符合 | B-001 |
| REQ-8842-04 | 取消原因必填 | 路由层校验 | ⚠️ 部分符合 | 仅校验非空，未校验枚举 |

### 1.2 核心业务流程审查

| 流程 | 预期行为 | 实际实现观察 | 风险 |
|------|----------|--------------|------|
| 主流程取消 | 状态 pending→cancelled | 与 design 状态机一致 | 低 |
| 重复提交 | 同一 cancelToken 仅生效一次 | 无 token / 无唯一约束 | **高** |
| 支付回调竞态 | 取消与支付成功互斥 | 有分布式锁 | 中 |

### 1.3 边界与场景

- [x] 空订单 ID — 返回 400
- [x] 权限不足 — 403
- [ ] 重复提交 — **未覆盖**（B-001）
- [x] 下游库存服务超时 — 有重试，缺降级说明

### 1.4 业务问题清单

#### B-001 [blocker] 重复取消未幂等，可能触发多次退款

| 属性 | 内容 |
|------|------|
| 关联需求 | REQ-8842-03 |
| 位置 | `src/services/OrderCancelService.ts:88-120` |
| 现象 | POST `/orders/:id/cancel` 每次均写库并调用支付退款 |
| 期望 | 同一 `Idempotency-Key` 重复请求返回首次结果，不重复副作用 |
| 影响 | 资金损失、对账异常 |
| 建议 | 增加 `cancel_requests(idempotency_key UNIQUE)` 或在 Redis 记录 24h 处理结果 |

---

## 2. 代码规范与技术质量

### 2.1 规范符合性总览

| 维度 | 评级 | 说明 |
|------|------|------|
| 命名与可读性 | B | |
| 分层与职责 | B | |
| 错误处理 | C | 部分 catch 吞掉 stack |
| 日志与可观测性 | B | |
| 测试 | C | 新增取消流程缺集成测 |
| 安全 | C | 见 C-002 |
| 性能 | A | |
| 依赖与配置 | A | |

### 2.2 代码规范问题清单

#### C-002 [major] 取消接口未校验 refundAmount 上限

| 属性 | 内容 |
|------|------|
| 规则 | 团队 API 规范：金额类字段须与订单应付比对 |
| 位置 | `src/routes/orderCancel.ts:31` |
| 问题 | `refundAmount` 直接透传支付层，无 `<= order.payable` 校验 |
| 建议 | 服务端计算退款额，或 Zod `max(order.payable)` |
| 可自动修复 | false |

#### C-003 [minor] 魔法数 30000 表示锁超时

| 属性 | 内容 |
|------|------|
| 位置 | `OrderCancelService.ts:102` |
| 建议 | 提取为 `CANCEL_LOCK_TTL_MS` 常量 |

### 2.3 安全专项检查

| 检查项 | 结果 | 发现编号 |
|--------|------|----------|
| 鉴权/授权 | pass | |
| 输入校验与注入 | fail | C-002 |
| 密钥/Token 不入日志 | pass | |
| 敏感数据脱敏 | pass | |

### 2.4 测试与可维护性

- **变更是否配有测试**：否 — 建议补充 `OrderCancelService` 幂等与竞态用例（对应 B-001）

---

## 3. 与设计文档差异

| 设计章节 | 设计描述 | 实现差异 | 判定 | 编号 |
|----------|----------|----------|------|------|
| §3.3 幂等 | 必须支持 Idempotency-Key | 未实现 | ❌ | B-001 |


---

## 5. 合并前检查清单

- [ ] 修复 B-001、C-002
- [ ] 补充幂等集成测试并通过 CI
- [ ] 产品确认 REQ-8842-04 原因枚举范围

---

## 6. 审查限制与说明

- 未审查 `**/generated/**` 与 lock 文件。
- 支付渠道沙箱配置未在仓库内，退款链路按代码静态分析。
