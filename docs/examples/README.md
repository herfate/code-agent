# Code Review 报告示例

| 文件 | 用途 |
|------|------|
| [`code-review-report.example.md`](./code-review-report.example.md) | Agent 输出样例；含 `## 审查摘要` + JSON 门禁字段 |
| [`code-review-out-tpl.example.txt`](./code-review-out-tpl.example.txt) | 可粘贴到 `prompt_tpl`（`task_type=8`，`tpl_key=2` out_tpl）的提示片段 |

## 落库门禁参数

Code Review 任务（`task_type=8`）完成后，流水线从变更文件中解析报告，写入 `parent_task_params`：

| param_key | value_json 类型 | 说明 |
|-----------|-----------------|------|
| `CodeReviewMergeAllowed` | `boolean` | 是否允许合并（`blocker>0` 或 `merge_recommendation=false` 时为 `false`） |
| `CodeReviewGateResult` | `object` | 完整摘要：`verdict`、`counts`、`must_fix_before_merge`、`summary_zh` 等 |

解析实现：[`src/services/file/parseTaskOutCodeReviewResult.ts`](../../src/services/file/parseTaskOutCodeReviewResult.ts)

## 未通过时自动重试

`CodeReviewMergeAllowed === false` 时，流水线会克隆同父任务下三条 Pending 任务（与编排顺序一致）：

1. **开发**（`description` 为审查报告摘要）
2. **测试环境发布**
3. **Code Review**

重试次数与同父任务下已有 Code Review 任务数比较，上限为全局 `max_retry_count`（与测试重试共用）。实现：[`cloneTasksOnCodeReviewNotPassed.ts`](../../src/services/loop/cloneTasksOnCodeReviewNotPassed.ts)、[`cloneTasksOnCodeReviewFailHandler.ts`](../../src/services/workflow/handlers/cloneTasksOnCodeReviewFailHandler.ts)。

本地验证解析（项目根目录执行）：

```bash
npx tsx -e "import { readFileSync } from 'node:fs'; import { buildParsedCodeReviewGate, extractCodeReviewSummaryJsonFromMarkdown } from './src/services/file/parseTaskOutCodeReviewResult.ts'; const c=readFileSync('docs/examples/code-review-report.example.md','utf8'); const j=extractCodeReviewSummaryJsonFromMarkdown(c); const p=buildParsedCodeReviewGate(j,'code-review-report.example.md'); console.log(JSON.stringify(p,null,2));"
```

预期：`mergeAllowed: false`，`verdict: "request_changes"`，`mustFixBeforeMerge` 含 `B-001` 与 `C-002`。
