import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { APPS, APP_KEYS, listAppKeysByGitRemoteUrl } from "../constants/appCatalog.js";

const lookupByGitQuery = z.object({
  gitRemoteUrl: z.string().trim().min(1).max(2000),
});

/** 应用目录只读 API（供前端按 git 地址反查应用） */
export function registerAppCatalogRoutes(app: FastifyInstance): void {
  app.get("/api/app-catalog/lookup-by-git", async (request, reply) => {
    const parsed = lookupByGitQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const keys = listAppKeysByGitRemoteUrl(parsed.data.gitRemoteUrl);
    const matches = keys.map((appKey) => ({
      appKey,
      repoId: APPS[appKey].repoId,
      gitlabUrl: APPS[appKey].gitlabUrl,
      category: APPS[appKey].category,
    }));

    return {
      matches,
      /** 唯一匹配时的 DevOps / QA 应用名（`repoId`） */
      repoId: matches.length === 1 ? matches[0]!.repoId : undefined,
    };
  });

  /** 全部应用目录（供前端「新增父任务」应用下拉，含 gitlabUrl 仓库地址） */
  app.get("/api/app-catalog/apps", async () => {
    return {
      apps: APP_KEYS.map((appKey) => ({
        appKey,
        repoId: APPS[appKey].repoId,
        gitlabUrl: APPS[appKey].gitlabUrl,
        category: APPS[appKey].category,
      })),
    };
  });
}
