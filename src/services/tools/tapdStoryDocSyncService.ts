import type { DatabaseSync } from "node:sqlite";
import { TASK_TYPE, type TaskType, taskTypeLabel } from "../../constants/taskType.js";
import { resolveTapdToken } from "../dbConfig.js";
import { readLatestAiOutMarkdown } from "../file/readLatestAiOutMarkdown.js";
import { markdownToHtml, truncateHtmlForTapd } from "./markdownToHtml.js";
import { createTapdComment, parseTapdStoryRef } from "./tapdClient.js";

/** 支持同步到 TAPD 评论的 ai_out task_type */
export const TAPD_SYNC_DOC_TASK_TYPES = [
  TASK_TYPE.Design,
  TASK_TYPE.TestCaseExecute,
  TASK_TYPE.CodeReview,
] as const;

export type TapdSyncDocTaskType = (typeof TAPD_SYNC_DOC_TASK_TYPES)[number];

const TAPD_SYNC_DOC_TASK_TYPE_SET = new Set<number>(TAPD_SYNC_DOC_TASK_TYPES);

export function isTapdSyncDocTaskType(taskType: number): taskType is TapdSyncDocTaskType {
  return TAPD_SYNC_DOC_TASK_TYPE_SET.has(taskType);
}

export type TapdStoryDocSyncResult = {
  workspace_id: string;
  story_id: string;
  comment_id: string;
  pid: string;
  task_type: number;
  relative_path: string;
  content_length: number;
  truncated: boolean;
};

function formatSyncTime(): string {
  try {
    return new Date().toLocaleString("zh-CN", { hour12: false });
  } catch {
    return new Date().toISOString();
  }
}

/** TAPD 评论标题（Markdown 源文一级标题） */
export function tapdSyncDocCommentTitle(taskType: TaskType): string {
  switch (taskType) {
    case TASK_TYPE.Design:
      return "设计文档（AI 同步）";
    case TASK_TYPE.TestCaseExecute:
      return "测试案例执行文档（AI 同步）";
    case TASK_TYPE.CodeReview:
      return "Code Review 文档（AI 同步）";
    default:
      return `${taskTypeLabel(taskType)}（AI 同步）`;
  }
}

/** 组装评论 Markdown 源文（后续转为 HTML 再提交 TAPD） */
export function buildAiOutDocCommentMarkdown(opts: {
  pid: string;
  taskType: TaskType;
  relativePath: string;
  markdown: string;
  truncated?: boolean;
}): string {
  const header = [
    `## ${tapdSyncDocCommentTitle(opts.taskType)}`,
    "",
    `> 来源：\`ai_out/${opts.pid}/${opts.taskType}/${opts.relativePath}\``,
    `> 同步时间：${formatSyncTime()}`,
    opts.truncated ? "> 注：正文过长，已截断至 TAPD 评论长度上限" : "",
    "",
  ]
    .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n");
  return `${header}\n${opts.markdown.trim()}`;
}

/** 将 ai_out 文档 Markdown 转为 TAPD 评论 HTML */
export function buildAiOutDocCommentHtml(opts: {
  pid: string;
  taskType: TaskType;
  relativePath: string;
  markdown: string;
  truncated?: boolean;
}): string {
  return markdownToHtml(buildAiOutDocCommentMarkdown(opts));
}

/** @deprecated 使用 {@link buildAiOutDocCommentMarkdown} */
export function buildDesignDocCommentMarkdown(opts: {
  pid: string;
  relativePath: string;
  markdown: string;
  truncated?: boolean;
}): string {
  return buildAiOutDocCommentMarkdown({ ...opts, taskType: TASK_TYPE.Design });
}

/** @deprecated 使用 {@link buildAiOutDocCommentHtml} */
export function buildDesignDocCommentHtml(opts: {
  pid: string;
  relativePath: string;
  markdown: string;
  truncated?: boolean;
}): string {
  return buildAiOutDocCommentHtml({ ...opts, taskType: TASK_TYPE.Design });
}

/**
 * 将 `ai_out/<pid>/<taskType>/` 下最新 Markdown 转为 HTML 后同步到 TAPD 需求评论。
 */
export async function syncAiOutDocToTapdStoryComment(
  db: DatabaseSync,
  opts: {
    tapdTaskId: string;
    pid: string;
    creator: string;
    taskType: TapdSyncDocTaskType;
    /** TAPD 评论人；默认与 creator 相同 */
    author?: string;
  },
): Promise<TapdStoryDocSyncResult> {
  const creator = opts.creator.trim();
  if (!creator) {
    throw new Error("creator 不能为空");
  }
  const author = (opts.author?.trim() || creator).trim();
  const pid = opts.pid.trim();
  if (!pid) {
    throw new Error("pid 不能为空");
  }
  const taskType = opts.taskType;
  if (!isTapdSyncDocTaskType(taskType)) {
    throw new Error("不支持的 task_type，仅支持 0 设计 / 6 测试案例执行 / 8 Code Review");
  }

  const ref = parseTapdStoryRef(opts.tapdTaskId);
  if (!ref) {
    throw new Error("无法解析 TAPD 关联，格式须为 story={短ID}@tapd-{空间ID}");
  }

  const token = resolveTapdToken(db, creator);
  if (!token) {
    throw new Error("未配置 TAPD Token，请在用户配置页设置");
  }

  const label = taskTypeLabel(taskType);
  const doc = readLatestAiOutMarkdown(pid, taskType);
  if (!doc) {
    throw new Error(
      `未找到${label}文档，请确认 ai_out/${pid}/${taskType}/ 下已有 .md 文件`,
    );
  }
  if (doc.content_kind !== "markdown") {
    throw new Error(
      `${label}输出不是 Markdown（${doc.relative_path}），仅支持同步 .md / .markdown 文档`,
    );
  }

  const htmlBody = buildAiOutDocCommentHtml({
    pid,
    taskType,
    relativePath: doc.relative_path,
    markdown: doc.content,
  });
  const { text: html, truncated } = truncateHtmlForTapd(htmlBody);

  const comment = await createTapdComment({
    workspaceId: ref.workspaceId,
    entryType: "stories",
    entryId: ref.storyId,
    description: html,
    author,
    token,
  });

  return {
    workspace_id: ref.workspaceId,
    story_id: ref.storyId,
    comment_id: comment.id,
    pid,
    task_type: doc.task_type,
    relative_path: doc.relative_path,
    content_length: html.length,
    truncated,
  };
}

/** @deprecated 使用 {@link syncAiOutDocToTapdStoryComment} */
export async function syncDesignDocToTapdStoryComment(
  db: DatabaseSync,
  opts: {
    tapdTaskId: string;
    pid: string;
    creator: string;
    author?: string;
  },
): Promise<TapdStoryDocSyncResult> {
  return syncAiOutDocToTapdStoryComment(db, { ...opts, taskType: TASK_TYPE.Design });
}
