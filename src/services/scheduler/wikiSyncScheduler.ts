import type { DatabaseSync } from "node:sqlite";
import { getWikiCategoryLabel } from "../../constants/wikiCategory.js";
import { listWikiCategoryIdsWithSyncConfig } from "../../db/wikiSource.js";
import { AppLog } from "../appLogger.js";
import { syncWikiCategoryCodeRepos } from "../wiki/codeRepoSyncService.js";
import { syncWikiCategoryFromConfluence } from "../wiki/wikiSyncService.js";
import { tryCreatePersistMemoryParentTaskAfterConfluenceSync } from "../wiki/persistMemoryAfterConfluenceSync.js";
import { syncWikiCategoryQaTestCases } from "../wiki/qaTestCaseSyncService.js";
import { syncWikiCategoryQaTestMindMaps } from "../wiki/qaTestMindMapSyncService.js";

export type WikiSyncSchedulerHandle = { stop: () => void };

/** 计算距离下一次本地时区 `hour:minute` 的毫秒数 */
function msUntilNextDailyRun(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * 每日定时同步 Wiki：Confluence 文档 → `wiki_base`，代码库 → `code_base`。
 * 仅处理至少配置了一条 Confluence 或代码库地址的业务分类。
 * 当 `createPersistMemory` 为 true 时，每个分类 Confluence 同步成功后若存在有效文档源，
 * 则自动创建知识沉淀父任务（类型 7：生成业务知识 → 生成代码规范 → 生成测试规范）。
 * `hour === -1` 时不启动。
 */
export function startWikiSyncScheduler(opts: {
  db: DatabaseSync;
  hour: number;
  minute?: number;
  /** 是否在 Confluence 同步后创建知识沉淀父任务；默认 false */
  createPersistMemory?: boolean;
}): WikiSyncSchedulerHandle | null {
  const { db, hour, minute = 0, createPersistMemory = false } = opts;
  if (hour < 0) return null;

  const log = AppLog.logger;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    const delayMs = msUntilNextDailyRun(hour, minute);
    log.info({ hour, minute, delayMs, createPersistMemory }, "wiki sync scheduler next run scheduled");
    timer = setTimeout(() => {
      void runSync().finally(scheduleNext);
    }, delayMs);
  };

  const runSync = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const categoryIds = listWikiCategoryIdsWithSyncConfig(db);
      if (categoryIds.length === 0) {
        log.info("wiki sync scheduler: no categories with sync config, skip");
        return;
      }
      log.info({ categoryIds, createPersistMemory }, "wiki sync scheduler start");
      for (const categoryId of categoryIds) {
        if (stopped) break;
        const label = getWikiCategoryLabel(categoryId) ?? categoryId;
        try {
          const confluence = await syncWikiCategoryFromConfluence(db, categoryId, {
            scope: "descendants",
          });
          log.info(
            {
              categoryId,
              label,
              kind: "confluence",
              sources: confluence.sources.map((s) => ({
                type: s.source_type_label,
                skipped: s.skipped ?? false,
                saved: s.saved,
                total: s.total,
                failed: s.failed,
              })),
            },
            "wiki sync scheduler category confluence done",
          );
          if (createPersistMemory) {
            // Confluence 同步成功后按分类新建知识沉淀父任务（类型 7）
            tryCreatePersistMemoryParentTaskAfterConfluenceSync(db, confluence);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "CONFLUENCE_CREDENTIALS_MISSING") {
            log.warn({ categoryId, label }, "wiki sync scheduler: confluence credentials missing, skip");
          } else {
            log.error({ err: e, categoryId, label }, "wiki sync scheduler confluence failed");
          }
        }

        try {
          const qaTestCases = await syncWikiCategoryQaTestCases(db, categoryId);
          log.info(
            {
              categoryId,
              label,
              kind: "qa_test_case",
              sources: qaTestCases.sources.map((s) => ({
                type: s.source_type_label,
                skipped: s.skipped ?? false,
                saved: s.saved_scripts,
                total: s.total_scripts,
                failed: s.failed_scripts,
              })),
            },
            "wiki sync scheduler category qa test cases done",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "QA_CREDENTIALS_MISSING") {
            log.warn({ categoryId, label }, "wiki sync scheduler: qa credentials missing, skip");
          } else {
            log.error({ err: e, categoryId, label }, "wiki sync scheduler qa test cases failed");
          }
        }

        try {
          const qaTestMindMaps = await syncWikiCategoryQaTestMindMaps(db, categoryId);
          log.info(
            {
              categoryId,
              label,
              kind: "qa_test_mind_map",
              sources: qaTestMindMaps.sources.map((s) => ({
                type: s.source_type_label,
                skipped: s.skipped ?? false,
                saved: s.saved_trees,
                total: s.total_trees,
                failed: s.failed_trees,
              })),
            },
            "wiki sync scheduler category qa test mind maps done",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "QA_CREDENTIALS_MISSING") {
            log.warn({ categoryId, label }, "wiki sync scheduler: qa credentials missing, skip");
          } else {
            log.error({ err: e, categoryId, label }, "wiki sync scheduler qa test mind maps failed");
          }
        }

        try {
          const codeRepos = await syncWikiCategoryCodeRepos(db, categoryId);
          log.info(
            {
              categoryId,
              label,
              kind: "code_repo",
              sources: codeRepos.sources.map((s) => ({
                type: s.source_type_label,
                skipped: s.skipped ?? false,
                action: s.action,
                error: s.error,
              })),
            },
            "wiki sync scheduler category code repos done",
          );
        } catch (e) {
          log.error({ err: e, categoryId, label }, "wiki sync scheduler code repos failed");
        }
      }
      log.info("wiki sync scheduler finished");
    } finally {
      running = false;
    }
  };

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
