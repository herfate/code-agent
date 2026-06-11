import { z } from "zod";
import { isTaskType } from "../constants/taskType.js";
import { isTplKey } from "../constants/tplKey.js";
import { zTaskCreator } from "./taskCreatorZod.js";

export const zTaskTypeNum = z.number().int().refine(isTaskType, { message: "非法 task_type" });
export const zTplKeyNum = z.number().int().refine(isTplKey, { message: "非法 tpl_key" });

/** Skill 配置保存请求体 */
export const skillConfigBody = z.object({
  username: zTaskCreator,
  skills: z.array(z.string().max(200)).max(100).default([]),
});

/** Skill 配置查询参数 */
export const skillConfigQuery = z.object({
  username: zTaskCreator,
});

/** Prompt 模板用户级保存请求体 */
export const promptTplUserBody = z.object({
  username: zTaskCreator,
  task_type: zTaskTypeNum,
  tpl_key: zTplKeyNum,
  prompt: z.string().max(50_000).default(""),
});

/** Prompt 模板用户级删除/查询参数 */
export const promptTplUserQuery = z.object({
  username: zTaskCreator,
  task_type: z.coerce.number().int().refine(isTaskType, { message: "非法 task_type" }),
  tpl_key: z.coerce.number().int().refine(isTplKey, { message: "非法 tpl_key" }),
});

/** Prompt 矩阵查询参数 */
export const promptTplMatrixQuery = z.object({
  username: zTaskCreator,
});