import type { DatabaseSync } from "node:sqlite";
import { PARENT_AGENT_TYPE } from "../../constants/parentAgentType.js";
import { WIKI_DOC_PARAM_KEY } from "../../constants/commonKey.js";
import { getWikiCategoryLabel, type WikiCategoryId } from "../../constants/wikiCategory.js";
import { WIKI_STORY_SPLIT_DOC_SOURCE_TYPES } from "../../constants/wikiSourceType.js";
import { nextParentTaskPid } from "../../db/parentTask.js";
import { AppLog } from "../appLogger.js";
import { createParentTaskWorkflow } from "../create/task/parentTaskCreateService.js";
import type { WikiCategorySyncResult } from "./wikiSyncService.js";

/** 定时同步自动创建知识沉淀任务时的固定创建人 */
export const WIKI_SYNC_PERSIST_MEMORY_CREATOR = "wiki-sync";

/** 本地日期 YYYY-MM-DD（用于标题） */
function localDateYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Confluence 同步成功后：若存在非 skip 的文档源，则新建父任务类型 7（知识沉淀 Agent）。
 * 创建失败只记日志，由调用方决定是否继续后续同步。
 */
export function createPersistMemoryParentTaskAfterConfluenceSync(
  db: DatabaseSync,
  syncResult: WikiCategorySyncResult,
): { pid: string } | null {
  const categoryId = syncResult.category_id as WikiCategoryId;
  const activeSources = syncResult.sources.filter((s) => !s.skipped);
  if (activeSources.length === 0) {
    AppLog.logger.info(
      { categoryId },
      "persist memory after confluence: no active confluence sources, skip",
    );
    return null;
  }

  const label = getWikiCategoryLabel(categoryId) ?? categoryId;
  const wikiMarker = `wiki_base/${categoryId}/`;
  const dateStr = localDateYmd();
  const title = `${label} · 知识沉淀 · ${dateStr}`;
  const requirement =
    `请根据已同步的 Confluence 文档（目录 ${wikiMarker}）依次完成：` +
    `生成业务知识、生成代码规范、生成测试规范。` +
    `工作区内已复制基线文档、迭代文档与系统优化文档。`;

  const pid = nextParentTaskPid(db);
  createParentTaskWorkflow(db, {
    pid,
    title,
    description: `Wiki定时同步 · ${wikiMarker}`,
    task_type: PARENT_AGENT_TYPE.PersistMemory,
    creator: WIKI_SYNC_PERSIST_MEMORY_CREATOR,
    requirement,
    gitRepos: [],
    provider: "claude",
    extraParams: [
      {
        param_key: WIKI_DOC_PARAM_KEY,
        value_json: JSON.stringify({
          category_id: categoryId,
          category_label: label,
          wiki_path: wikiMarker,
          include_doc_types: [...WIKI_STORY_SPLIT_DOC_SOURCE_TYPES],
          include_code_repo_slots: [],
        }),
        description: "Wiki 文档来源（Confluence 定时同步）",
      },
    ],
  });

  AppLog.logger.info(
    { categoryId, label, pid, title },
    "persist memory after confluence: parent task created",
  );
  return { pid };
}

/** 包装：捕获异常并打日志，不向外抛出 */
export function tryCreatePersistMemoryParentTaskAfterConfluenceSync(
  db: DatabaseSync,
  syncResult: WikiCategorySyncResult,
): { pid: string } | null {
  try {
    return createPersistMemoryParentTaskAfterConfluenceSync(db, syncResult);
  } catch (e) {
    AppLog.logger.error(
      { err: e, categoryId: syncResult.category_id },
      "persist memory after confluence: create parent task failed",
    );
    return null;
  }
}
