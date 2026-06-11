/** 新建父任务占位标题，待 AI 异步汇总后替换 */
export const PARENT_TASK_PLACEHOLDER_TITLE = "thinking";

/** 头脑风暴故事提交时的标题后缀，AI 汇总后仅替换该段 */
export const PARENT_TASK_TITLE_THINKING_TOKEN = "thinking";

/** 是否为待 AI 汇总的占位标题（纯 thinking 或 故事N-thinking） */
export function isParentTaskTitlePendingAi(title: string | undefined | null): boolean {
  const t = title?.trim();
  if (!t) return true;
  if (t === PARENT_TASK_PLACEHOLDER_TITLE) return true;
  return t.endsWith(`-${PARENT_TASK_TITLE_THINKING_TOKEN}`);
}

/** 将 AI 汇总标题写回占位标题：thinking → 汇总标题；故事1-thinking → 故事1-汇总标题 */
export function applyAiTitleToPlaceholder(currentTitle: string, aiTitle: string): string {
  const t = currentTitle.trim();
  const summary = aiTitle.trim();
  if (!summary) return t;
  if (t === PARENT_TASK_PLACEHOLDER_TITLE) return summary;
  if (t.endsWith(`-${PARENT_TASK_TITLE_THINKING_TOKEN}`)) {
    return t.slice(0, -PARENT_TASK_TITLE_THINKING_TOKEN.length) + summary;
  }
  return summary;
}
