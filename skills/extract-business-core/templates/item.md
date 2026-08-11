---
id: example-subsystem
title: 示例子系统
category: business-core
status: candidate
confidence: medium
evidence:
  - path/to/entry.ts
  - path/to/service.ts
updated: YYYY-MM-DD
---

# 简述

（一两句概括本子系统/用例职责与边界，勿重复 title）

## 职责与边界

- **做**：…
- **不做**：…

## 领域概念

| 术语 | 含义 |
|------|------|
| … | … |

## 主流程

1. …
2. …

```mermaid
flowchart TD
  startNode[Start] --> endNode[End]
```

## 失败与边界

- …

## 关键接口 / 表 / 消息

| 类型 | 名称 | 说明 |
|------|------|------|
| API / 表 / MQ | … | … |

## 坑点与注意事项

- …
