import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { resolveTapdToken, resolveTapdWorkspaceId } from "../services/dbConfig.js";
import {
  createTapdChildStory,
  fetchTapdStoryById,
  fetchTapdStoryFieldsInfo,
  parseTapdStoryId,
  pickLatestIterationFromFieldsInfo,
} from "../services/tools/tapdClient.js";
import { markdownToTapdHtml } from "../services/tools/markdownToHtml.js";
import {
  completeTapdStoryWithStandardTasks,
  TAPD_STORY_COMPLETE_TASK_NAMES,
} from "../services/tools/tapdStoryCompleteService.js";
import {
  isTapdSyncDocTaskType,
  syncAiOutDocToTapdStoryComment,
  TAPD_SYNC_DOC_TASK_TYPES,
} from "../services/tools/tapdStoryDocSyncService.js";

const resolveBody = z.object({
  /** TAPD 需求链接、story={id}@tapd-* 或纯数字 story id（workspace 取自 system_config） */
  story_ref: z.string().trim().min(1).max(2000),
  creator: z.string().trim().min(1).max(200),
});

const createChildBody = z.object({
  parent_id: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(100_000),
  creator: z.string().trim().min(1).max(200),
  /** 迭代 ID；不传则不带 iteration_id */
  iteration_id: z.string().trim().min(1).max(50).optional(),
  /** 处理人；不传则不带 owner */
  owner: z.string().trim().min(1).max(200).optional(),
});

const fieldsInfoQuery = z.object({
  creator: z.string().trim().min(1).max(200),
});

const storySyncDesignDocBody = z.object({
  /** `story={短ID}@tapd-{空间ID}` */
  tapd_task_id: z.string().trim().min(1).max(200),
  /** 本地 parent_task.pid，用于读取 ai_out/<pid>/<task_type>/ 文档 */
  pid: z.string().trim().min(1).max(50),
  creator: z.string().trim().min(1).max(200),
  /** ai_out 子目录 task_type：0 设计 / 6 测试案例执行 / 8 Code Review / 12 UI测试执行，默认 0 */
  task_type: z.coerce
    .number()
    .int()
    .refine((n) => isTapdSyncDocTaskType(n), {
      message: "task_type 仅支持 0 设计 / 6 测试案例执行 / 8 Code Review / 12 UI测试执行",
    })
    .optional()
    .default(TAPD_SYNC_DOC_TASK_TYPES[0]),
  /** TAPD 评论人；省略则与 creator 相同 */
  author: z.string().trim().min(1).max(200).optional(),
});

const storyCompleteBody = z.object({
  /** `story={短ID}@tapd-{空间ID}` */
  tapd_task_id: z.string().trim().min(1).max(200),
  /** 本地 parent_task 标题 */
  local_task_title: z.string().trim().min(1).max(500),
  creator: z.string().trim().min(1).max(200),
  /** TAPD 花费人（汉字姓名） */
  owner: z.string().trim().min(1).max(200),
  /** 可选：覆盖默认工时（设计 2h / 开发 8h / 自测 2h） */
  efforts: z
    .object({
      设计: z.string().trim().min(1).max(20).optional(),
      开发: z.string().trim().min(1).max(20).optional(),
      自测: z.string().trim().min(1).max(20).optional(),
    })
    .optional(),
  /** 任务起止日与工时花费日（YYYY-MM-DD），默认当天 */
  spentdate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "spentdate 格式须为 YYYY-MM-DD")
    .optional(),
  /** 需求完成状态（中文 v_status），默认「已实现」 */
  story_done_v_status: z.string().trim().min(1).max(100).optional(),
});

function isTapdClientError(msg: string): boolean {
  return (
    msg.includes("未配置 TAPD Token") ||
    msg.includes("未配置 TAPD workspace_id") ||
    msg.includes("TAPD Token") ||
    msg.includes("TAPD 花费人") ||
    msg.includes("TAPD 关联") ||
    msg.includes("无法解析 TAPD") ||
    msg.includes("已存在同名任务") ||
    msg.includes("填报工时失败") ||
    msg.includes("spentdate") ||
    msg.includes("未找到设计文档") ||
    msg.includes("未找到") ||
    msg.includes("输出不是 Markdown") ||
    msg.includes("设计输出不是 Markdown") ||
    msg.includes("不支持的 task_type") ||
    msg.includes("创建评论") ||
    msg.includes("workspace_id") ||
    msg.includes("parent_id") ||
    msg.includes("story_id") ||
    msg.includes("entity_id") ||
    msg.includes("timespent") ||
    msg.includes("未找到对应 TAPD 需求") ||
    msg.includes("无法解析") ||
    msg.includes("不能为空") ||
    msg.includes("标题不能为空")
  );
}

export function registerTapdRoutes(app: FastifyInstance, opts: { db: DatabaseSync }) {
  const { db } = opts;

  /** 解析 TAPD 父需求地址并返回父需求名称 */
  app.post("/api/tapd/stories/resolve", async (request, reply) => {
    const parsed = resolveBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { story_ref, creator } = parsed.data;
    const workspaceId = resolveTapdWorkspaceId(db, creator);
    if (!workspaceId) {
      return reply.status(400).send({
        error: "未配置 TAPD workspace_id，请在 system_config 中设置 tapd_workspace_id",
      });
    }

    const storyId = parseTapdStoryId(story_ref);
    if (!storyId) {
      return reply.status(400).send({
        error: "无法解析 TAPD 需求地址，请粘贴需求链接、--story=短ID@tapd-空间ID、story={id}@tapd-* 或纯数字 story id",
      });
    }

    const token = resolveTapdToken(db, creator);
    if (!token) {
      return reply.status(400).send({ error: "未配置 TAPD Token，请在用户配置页设置" });
    }

    try {
      const story = await fetchTapdStoryById({
        workspaceId,
        storyId,
        token,
      });
      return reply.send({
        workspace_id: workspaceId,
        story_id: story.id,
        name: story.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTapdClientError(msg)) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "tapd story resolve failed");
      return reply.status(500).send({ error: msg });
    }
  });

  /** 获取需求字段信息，并返回最新 iteration_id（按 pure_options.sort 最大） */
  app.get("/api/tapd/stories/fields-info", async (request, reply) => {
    const parsed = fieldsInfoQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { creator } = parsed.data;
    const workspaceId = resolveTapdWorkspaceId(db, creator);
    if (!workspaceId) {
      return reply.status(400).send({
        error: "未配置 TAPD workspace_id，请在 system_config 中设置 tapd_workspace_id",
      });
    }

    const token = resolveTapdToken(db, creator);
    if (!token) {
      return reply.status(400).send({ error: "未配置 TAPD Token，请在用户配置页设置" });
    }

    try {
      const fieldsInfo = await fetchTapdStoryFieldsInfo({ workspaceId, token });
      const latestIteration = pickLatestIterationFromFieldsInfo(fieldsInfo);
      return reply.send({
        workspace_id: workspaceId,
        latest_iteration: latestIteration,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTapdClientError(msg)) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "tapd story fields info failed");
      return reply.status(500).send({ error: msg });
    }
  });

  /** 在父需求下创建子需求 */
  app.post("/api/tapd/stories/child", async (request, reply) => {
    const parsed = createChildBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { parent_id, name, description, creator, iteration_id, owner } = parsed.data;
    const workspaceId = resolveTapdWorkspaceId(db, creator);
    if (!workspaceId) {
      return reply.status(400).send({
        error: "未配置 TAPD workspace_id，请在 system_config 中设置 tapd_workspace_id",
      });
    }

    const token = resolveTapdToken(db, creator);
    if (!token) {
      return reply.status(400).send({ error: "未配置 TAPD Token，请在用户配置页设置" });
    }
    try {
      const { html: descriptionHtml } = markdownToTapdHtml(description);
      const story = await createTapdChildStory({
        workspaceId,
        parentId: parent_id,
        name,
        description: descriptionHtml,
        token,
        iterationId: iteration_id,
        owner,
      });
      return reply.send({
        workspace_id: workspaceId,
        parent_id,
        story_id: story.id,
        name: story.name,
        iteration_id: iteration_id ?? null,
        owner: owner ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTapdClientError(msg)) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "tapd child story create failed");
      return reply.status(500).send({ error: msg });
    }
  });

  /** 将 ai_out 文档（0/6/8）以 Markdown 转 HTML 后同步到 TAPD 需求评论 */
  app.post("/api/tapd/stories/sync-design-doc-comment", async (request, reply) => {
    const parsed = storySyncDesignDocBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { tapd_task_id, pid, creator, author, task_type } = parsed.data;
    try {
      const result = await syncAiOutDocToTapdStoryComment(db, {
        tapdTaskId: tapd_task_id,
        pid,
        creator,
        author,
        taskType: task_type,
      });
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTapdClientError(msg)) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "tapd sync doc comment failed");
      return reply.status(500).send({ error: msg });
    }
  });

  /** 故事完成：创建设计/开发/自测任务、填报工时并标记需求完成 */
  app.post("/api/tapd/stories/complete-with-tasks", async (request, reply) => {
    const parsed = storyCompleteBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const {
      tapd_task_id,
      local_task_title,
      creator,
      owner,
      efforts,
      spentdate,
      story_done_v_status,
    } = parsed.data;
    try {
      const result = await completeTapdStoryWithStandardTasks(db, {
        tapdTaskId: tapd_task_id,
        localTaskTitle: local_task_title,
        creator,
        owner,
        efforts,
        spentdate,
        storyDoneVStatus: story_done_v_status,
      });
      return reply.send({
        ...result,
        task_names: [...TAPD_STORY_COMPLETE_TASK_NAMES],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTapdClientError(msg)) {
        return reply.status(400).send({ error: msg });
      }
      request.log.error(err, "tapd story complete with tasks failed");
      return reply.status(500).send({ error: msg });
    }
  });
}
