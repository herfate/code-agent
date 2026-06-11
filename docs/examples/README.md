# 示例模板与报告

## AI 拆分故事（task_type=11）

| 文件 | 用途 |
|------|------|
| [`ai-story-split-init-tpl.example.md`](./ai-story-split-init-tpl.example.md) | 可粘贴到 `prompt_tpl`（`task_type=11`，`tpl_key=1` init）的 Agent 提示词 |
| [`ai-story-split-out-tpl.example.txt`](./ai-story-split-out-tpl.example.txt) | 可粘贴到 `prompt_tpl`（`task_type=11`，`tpl_key=2` out_tpl）的输出结构模板 |
| [`ai-story-split-story.example.md`](./ai-story-split-story.example.md) | Agent 输出样例；单文件 `story_N.md` |

落库后流水线从变更文件中解析 `story_N.md`，按正文克隆头脑风暴子任务（见 `parseTaskOutAiStorySplitResult.ts`）。

## Code Review

| 文件 | 用途 |
|------|------|
| [`code-review-report.example.md`](./code-review-report.example.md) | Agent 输出样例；含 `## 审查摘要` + JSON 门禁字段 |
| [`code-review-out-tpl.example.txt`](./code-review-out-tpl.example.txt) | 可粘贴到 `prompt_tpl`（`task_type=8`，`tpl_key=2` out_tpl）的提示片段 |

## 功能测试用例生成（task_type=20）

| 文件 | 用途 |
|------|------|
| [`functest-case-gen-init-tpl.example.md`](./functest-case-gen-init-tpl.example.md) | 可粘贴到 `prompt_tpl`（`task_type=20`，`tpl_key=1` init）的 Agent 提示词 |
| [`functest-case-gen-out-tpl.example.txt`](./functest-case-gen-out-tpl.example.txt) | 可粘贴到 `prompt_tpl`（`task_type=20`，`tpl_key=2` out_tpl）的输出结构模板 |
| [`functest-case-design.example.json`](./functest-case-design.example.json) | Agent 输出样例；纯 JSON，可直接 `JSON.parse` 后导出 Excel |

主输出为 **`test_case_design.json`**：`columns` 定义 Excel 表头，`cases[]` 每项对应一行；`*_text` 字段为单元格合并文本，数组字段（`steps` / `expected_results` / `data_sql`）供程序化处理。

## 自动化用例生成（task_type=21）

| 文件 | 用途 |
|------|------|
| [`autotest-case-gen-init-tpl.example.md`](./autotest-case-gen-init-tpl.example.md) | 可粘贴到 `prompt_tpl`（`task_type=21`，`tpl_key=1` init）的 Agent 提示词 |
| [`autotest-case-gen-out-tpl.example.txt`](./autotest-case-gen-out-tpl.example.txt) | 可粘贴到 `prompt_tpl`（`task_type=21`，`tpl_key=2` out_tpl）的输出结构模板 |
| [`autotest-case-manifest.example.md`](./autotest-case-manifest.example.md) | Agent 输出样例；含 `## 设计摘要` + JSON 门禁字段 |

落库方式：init 模板内容写入 `prompt_tpl.prompt`；out 模板内容在任务认领时写入任务仓库 `task_out_tpl.txt`（见 [`writeClaimedTaskOutTplFile.ts`](../../src/services/file/writeClaimedTaskOutTplFile.ts)）。

**路径约定**：Agent `cwd` 为 `task-repo/<pid>_<workspaceId>/`；功能测试主输出 `test_case_design.json` 在 cwd 根目录；Wiki 复制后已有案例在 `自动化测试案例/`，自动化用例新增 JSON 与 `test_cases_manifest.md` 均相对 cwd 输出，**不使用 `wiki_base/`**。

## UI 测试执行（task_type=12）

| 文件 | 用途 |
|------|------|
| [`ui-test-execute-init-tpl.example.md`](./ui-test-execute-init-tpl.example.md) | 可粘贴到 `prompt_tpl`（`task_type=12`，`tpl_key=1` init）的 Agent 提示词 |
| [`ui-test-execute-out-tpl.example.txt`](./ui-test-execute-out-tpl.example.txt) | 可粘贴到 `prompt_tpl`（`task_type=12`，`tpl_key=2` out_tpl）的输出结构模板 |
| [`ui-test-execute-report.example.md`](./ui-test-execute-report.example.md) | Agent 输出样例；含 `## 执行摘要` JSON、`## 测试结果` 门禁表、用例截图引用 |

触发：开发提交含 UI 源码（`.js` / `.vue` / `.jsp` / `.html`）时，从 Design 克隆一条 UI 测试执行任务（见 [`cloneUiTestExecuteFromDesign.ts`](../../src/services/loop/cloneUiTestExecuteFromDesign.ts)）。MCP 使用 `test` 档（howbuy-remote 等；**验收本身用无头 Playwright 脚本**，不以 Playwright MCP 点选代替）。

主输出：

- **`ui-tests/`**（或仓库既有 Playwright 目录）：`*.spec.ts` + `playwright.config.ts`
- **`ui_test_report.md`**：带截图的执行报告（Markdown 相对路径引用图片）
- **`ui_test_screenshots/*.png`**：脚本内 `page.screenshot` / 失败产物整理后的证据

「测试结果」表字段与测试案例执行对齐（含 `测试用例通过率`），便于预览解析；变更文件落库键为 `UiTestExecuteOut`。

## 落库门禁参数

Code Review 任务（`task_type=8`）完成后，流水线从变更文件中解析报告，写入 `parent_task_params`：

| param_key | value_json 类型 | 说明 |
|-----------|-----------------|------|
| `CodeReviewMergeAllowed` | `boolean` | 是否允许合并（`blocker>0` 或 `merge_recommendation=false` 时为 `false`） |
| `CodeReviewGateResult` | `object` | 完整摘要：`verdict`、`counts`、`must_fix_before_merge`、`summary_zh` 等 |

解析实现：[`src/services/file/parseTaskOutCodeReviewResult.ts`](../../src/services/file/parseTaskOutCodeReviewResult.ts)

## 未通过时自动重试

`CodeReviewMergeAllowed === false` 时，流水线会克隆同父任务下三条 Pending 任务（与编排顺序一致）：

1. **开发**（保留原 `description`，审查报告追加到 `meta_json.followUpMessages`）
2. **测试环境发布**
3. **Code Review**

重试次数与同父任务下已有 Code Review 任务数比较，上限为全局 `max_retry_count`（与测试重试共用）。实现：[`cloneTasksOnCodeReviewNotPassed.ts`](../../src/services/loop/cloneTasksOnCodeReviewNotPassed.ts)、[`cloneTasksOnCodeReviewFailHandler.ts`](../../src/services/workflow/handlers/cloneTasksOnCodeReviewFailHandler.ts)。

本地验证解析（项目根目录执行）：

```bash
npx tsx -e "import { readFileSync } from 'node:fs'; import { buildParsedCodeReviewGate, extractCodeReviewSummaryJsonFromMarkdown } from './src/services/file/parseTaskOutCodeReviewResult.ts'; const c=readFileSync('docs/examples/code-review-report.example.md','utf8'); const j=extractCodeReviewSummaryJsonFromMarkdown(c); const p=buildParsedCodeReviewGate(j,'code-review-report.example.md'); console.log(JSON.stringify(p,null,2));"
```

预期：`mergeAllowed: false`，`verdict: "request_changes"`，`mustFixBeforeMerge` 含 `B-001` 与 `C-002`。
