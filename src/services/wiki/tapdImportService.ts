import type { DatabaseSync } from "node:sqlite";
import { PARENT_AGENT_TYPE } from "../../constants/parentAgentType.js";
import { nextParentTaskPid } from "../../db/parentTask.js";
import { resolveTapdToken } from "../dbConfig.js";
import { createParentTaskWorkflow } from "../create/task/parentTaskCreateService.js";
import { formatTapdStoryIdWithWorkspace } from "../claude/tapdTaskIdFormat.js";
import { fetchTapdStoriesByParent, type TapdStoryItem } from "../tools/tapdClient.js";
import type { WikiCategoryId } from "../../constants/wikiCategory.js";

export type TapdImportResultItem = {
  pid: string;
  title: string;
  tapd_story_id: string;
  tapd_task_id: string;
};

export type TapdImportResult = {
  workspace_id: string;
  parent_id: string;
  fetched: number;
  imported: number;
  items: TapdImportResultItem[];
};

/** 去掉 TAPD 描述中的 HTML 标签，保留纯文本需求 */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildStoryRequirement(story: TapdStoryItem): string {
  const desc = story.description ? stripHtmlToText(story.description) : "";
  if (desc) return desc;
  return story.name.trim();
}


/**
 * 从 TAPD 拉取 parent_id 下故事并创建业务 Agent 父任务（task_type=4）。
 */
export async function importTapdStoriesAsParentTasks(
  db: DatabaseSync,
  opts: {
    categoryId: WikiCategoryId;
    workspaceId: string;
    parentId: string;
    creator: string;
  },
): Promise<TapdImportResult> {
  const creator = opts.creator.trim();
  if (!creator) {
    throw new Error("creator is required");
  }

  const token = resolveTapdToken(db, creator);
  if (!token) {
    throw new Error("未配置 TAPD Token，请在用户配置页设置");
  }

  const workspaceId = opts.workspaceId.trim();
  const parentId = opts.parentId.trim();
  const stories = await fetchTapdStoriesByParent({
    workspaceId,
    parentId,
    token,
  });

  const items: TapdImportResultItem[] = [];
  const wikiMarker = `wiki_base/${opts.categoryId}/`;

  for (const story of stories) {
    const tapdTaskId = formatTapdStoryIdWithWorkspace(story.id, workspaceId);
    const requirement = buildStoryRequirement(story);
    const pid = nextParentTaskPid(db);

    createParentTaskWorkflow(db, {
      pid,
      title: story.name.trim(),
      description: `TAPD导入 · ${wikiMarker} · ${tapdTaskId}`,
      task_type: PARENT_AGENT_TYPE.BizAgent,
      creator,
      requirement,
      tapdTaskId,
      gitRepos: [],
      testEnv: "wiki",
      provider: "claude",
    });

    items.push({
      pid,
      title: story.name.trim(),
      tapd_story_id: story.id,
      tapd_task_id: tapdTaskId,
    });
  }

  return {
    workspace_id: workspaceId,
    parent_id: parentId,
    fetched: stories.length,
    imported: items.length,
    items,
  };
}
