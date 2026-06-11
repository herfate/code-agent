import {
  TAPD_FE_STORY_URL_RE,
  TAPD_PRONG_STORY_URL_RE,
  TAPD_SHORT_STORY_URL_RE,
  TAPD_TASK_ID_EXTRACT_RE,
} from "../claude/tapdTaskIdFormat.js";
import { ensureTapdShortStoryId, tapdShortStoryIdToLong } from "./tapdStoryId.js";

/** TAPD Open API 故事列表字段（与导入接口 query 一致） */
export const TAPD_STORY_LIST_FIELDS = "id,name,status,parent_id,level,description";

export type TapdStoryItem = {
  id: string;
  name: string;
  status?: string;
  parent_id?: string;
  level?: string;
  description?: string;
};

export type TapdStoryRef = {
  workspaceId: string;
  storyId: string;
};

type TapdStoriesResponse = {
  status?: number;
  info?: string;
  data?: Array<{ Story?: Record<string, unknown> }>;
};

type TapdStoryCreateResponse = {
  status?: number;
  info?: string;
  data?: { Story?: Record<string, unknown> };
};

type TapdTaskCreateResponse = {
  status?: number;
  info?: string;
  data?: { Task?: Record<string, unknown> };
};

type TapdTasksResponse = {
  status?: number;
  info?: string;
  data?: Array<{ Task?: Record<string, unknown> }>;
};

type TapdGenericResponse = {
  status?: number;
  info?: string;
  data?: unknown;
};

export type TapdIterationOption = {
  value: string;
  label: string;
};

export type TapdTaskItem = {
  id: string;
  name: string;
  story_id?: string;
  effort?: string;
  status?: string;
};

const TAPD_API_BASE = "https://api.tapd.cn";

function normalizeTapdStoryItem(item: TapdStoryItem, workspaceId: string): TapdStoryItem {
  return {
    ...item,
    id: ensureTapdShortStoryId(item.id, workspaceId),
  };
}

/** 用户/全局 `tapd_token` → `Authorization: Bearer …` 请求头 */
function buildTapdAuthHeaders(token: string): Record<string, string> {
  const raw = token.trim().replace(/^Bearer\s+/i, "");
  if (!raw) {
    throw new Error("未配置 TAPD Token，请在用户配置页设置");
  }
  return { Authorization: `Bearer ${raw}` };
}

function readStoryField(story: Record<string, unknown>, key: string): string | undefined {
  const v = story[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function parseTapdStoryRow(raw: Record<string, unknown>): TapdStoryItem | null {
  const id = readStoryField(raw, "id");
  const name = readStoryField(raw, "name");
  if (!id || !name) return null;
  return {
    id,
    name,
    status: readStoryField(raw, "status"),
    parent_id: readStoryField(raw, "parent_id"),
    level: readStoryField(raw, "level"),
    description: readStoryField(raw, "description"),
  };
}

function parseTapdTaskRow(raw: Record<string, unknown>): TapdTaskItem | null {
  const id = readStoryField(raw, "id");
  const name = readStoryField(raw, "name");
  if (!id || !name) return null;
  return {
    id,
    name,
    story_id: readStoryField(raw, "story_id"),
    effort: readStoryField(raw, "effort"),
    status: readStoryField(raw, "status"),
  };
}

/** TAPD Open API 需长 ID；短 ID 按云环境规则转换 */
export function toTapdApiEntityId(entityId: string, workspaceId: string): string {
  return tapdShortStoryIdToLong(entityId.trim(), workspaceId.trim());
}

function parseTapdJsonResponse(bodyText: string, httpStatus: number): TapdStoriesResponse {
  let parsed: TapdStoriesResponse;
  try {
    parsed = JSON.parse(bodyText) as TapdStoriesResponse;
  } catch {
    throw new Error(`TAPD 响应非 JSON（HTTP ${httpStatus}）`);
  }
  if (!httpStatus || httpStatus < 400) {
    if (parsed.status !== 1) {
      throw new Error(parsed.info?.trim() || "TAPD 返回失败");
    }
    return parsed;
  }
  throw new Error(parsed.info?.trim() || `TAPD HTTP ${httpStatus}`);
}

function parseTapdGenericJsonResponse(bodyText: string, httpStatus: number): TapdGenericResponse {
  let parsed: TapdGenericResponse;
  try {
    parsed = JSON.parse(bodyText) as TapdGenericResponse;
  } catch {
    throw new Error(`TAPD 响应非 JSON（HTTP ${httpStatus}）`);
  }
  if (!httpStatus || httpStatus < 400) {
    if (parsed.status !== 1) {
      throw new Error(parsed.info?.trim() || "TAPD 返回失败");
    }
    return parsed;
  }
  throw new Error(parsed.info?.trim() || `TAPD HTTP ${httpStatus}`);
}

/** 从 get_fields_info 的 iteration_id 中取 sort 最大的一项（最新迭代） */
export function pickLatestIterationFromFieldsInfo(
  fieldsInfo: Record<string, unknown>,
): TapdIterationOption | null {
  const iterationField = fieldsInfo.iteration_id;
  if (!iterationField || typeof iterationField !== "object") return null;
  const field = iterationField as Record<string, unknown>;
  const pureOptions = field.pure_options;
  if (Array.isArray(pureOptions) && pureOptions.length > 0) {
    let best: TapdIterationOption & { sort: number } | null = null;
    for (const row of pureOptions) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const value = o.value != null ? String(o.value).trim() : "";
      if (!value) continue;
      const label = o.label != null ? String(o.label).trim() : value;
      const sortRaw = o.sort != null ? Number(o.sort) : 0;
      const sort = Number.isFinite(sortRaw) ? sortRaw : 0;
      if (!best || sort > best.sort) {
        best = { value, label, sort };
      }
    }
    if (best) return { value: best.value, label: best.label };
  }
  const options = field.options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    const entries = Object.entries(options as Record<string, string>);
    if (!entries.length) return null;
    const [value, label] = entries[entries.length - 1];
    return { value: String(value), label: String(label) };
  }
  return null;
}

async function tapdGet(
  token: string,
  path: string,
  query: Record<string, string>,
): Promise<TapdGenericResponse> {
  const url = new URL(`${TAPD_API_BASE}${path}`);
  for (const [key, val] of Object.entries(query)) {
    url.searchParams.set(key, val);
  }
  const headers = buildTapdAuthHeaders(token);
  let res: Response;
  try {
    res = await fetch(url.toString(), { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`TAPD 请求失败: ${msg}`);
  }
  const bodyText = await res.text();
  return parseTapdGenericJsonResponse(bodyText, res.status);
}

/** 从 TAPD 链接或 `story={id}@tapd-{workspaceId}` 提取 workspace / story */
export function parseTapdStoryRef(raw: string | null | undefined): TapdStoryRef | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  const taskIdMatch = TAPD_TASK_ID_EXTRACT_RE.exec(value);
  if (taskIdMatch) {
    return { storyId: taskIdMatch[1], workspaceId: taskIdMatch[2] };
  }

  const feMatch = TAPD_FE_STORY_URL_RE.exec(value);
  if (feMatch) {
    return { workspaceId: feMatch[1], storyId: feMatch[2] };
  }

  const prongMatch = TAPD_PRONG_STORY_URL_RE.exec(value);
  if (prongMatch) {
    return { workspaceId: prongMatch[1], storyId: prongMatch[2] };
  }

  const shortMatch = TAPD_SHORT_STORY_URL_RE.exec(value);
  if (shortMatch) {
    return { workspaceId: shortMatch[1], storyId: shortMatch[2] };
  }

  return null;
}

/** 从 TAPD 链接、`story={id}@tapd-*` 或纯数字 story id 提取需求 id（workspace 由 system_config 提供） */
export function parseTapdStoryId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  const taskIdMatch = TAPD_TASK_ID_EXTRACT_RE.exec(value);
  if (taskIdMatch) return taskIdMatch[1];

  const feMatch = TAPD_FE_STORY_URL_RE.exec(value);
  if (feMatch) return feMatch[2];

  const prongMatch = TAPD_PRONG_STORY_URL_RE.exec(value);
  if (prongMatch) return prongMatch[2];

  const shortMatch = TAPD_SHORT_STORY_URL_RE.exec(value);
  if (shortMatch) return shortMatch[2];

  if (/^\d+$/.test(value)) return value;

  return null;
}

async function tapdGetStories(
  token: string,
  query: Record<string, string>,
): Promise<TapdStoriesResponse> {
  const url = new URL(`${TAPD_API_BASE}/stories`);
  for (const [key, val] of Object.entries(query)) {
    url.searchParams.set(key, val);
  }

  const headers = buildTapdAuthHeaders(token);
  let res: Response;
  try {
    res = await fetch(url.toString(), { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`TAPD 请求失败: ${msg}`);
  }

  const bodyText = await res.text();
  return parseTapdJsonResponse(bodyText, res.status);
}

function storiesResponseToItems(parsed: TapdStoriesResponse): TapdStoryItem[] {
  const items: TapdStoryItem[] = [];
  for (const row of parsed.data ?? []) {
    const story = row?.Story;
    if (!story || typeof story !== "object") continue;
    const item = parseTapdStoryRow(story);
    if (item) items.push(item);
  }
  return items;
}

/**
 * 按 workspace_id + parent_id 拉取 TAPD 子故事列表。
 * @see https://api.tapd.cn/stories
 */
export async function fetchTapdStoriesByParent(params: {
  workspaceId: string;
  parentId: string;
  token: string;
}): Promise<TapdStoryItem[]> {
  const workspaceId = params.workspaceId.trim();
  const parentId = params.parentId.trim();
  if (!workspaceId || !parentId) {
    throw new Error("workspace_id 与 parent_id 不能为空");
  }

  const parsed = await tapdGetStories(params.token, {
    workspace_id: workspaceId,
    parent_id: parentId,
    fields: TAPD_STORY_LIST_FIELDS,
  });
  return storiesResponseToItems(parsed).map((item) => normalizeTapdStoryItem(item, workspaceId));
}

/**
 * 按 workspace_id + id 拉取单条 TAPD 需求。
 */
export async function fetchTapdStoryById(params: {
  workspaceId: string;
  storyId: string;
  token: string;
}): Promise<TapdStoryItem> {
  const workspaceId = params.workspaceId.trim();
  const storyId = toTapdApiEntityId(params.storyId, workspaceId);
  if (!workspaceId || !storyId) {
    throw new Error("workspace_id 与 story_id 不能为空");
  }

  const parsed = await tapdGetStories(params.token, {
    workspace_id: workspaceId,
    id: storyId,
    fields: TAPD_STORY_LIST_FIELDS,
  });
  const items = storiesResponseToItems(parsed);
  if (!items.length) {
    throw new Error("未找到对应 TAPD 需求，请检查需求地址与 Token 权限");
  }
  return normalizeTapdStoryItem(items[0], workspaceId);
}

/**
 * 获取需求字段及候选值。
 * @see https://api.tapd.cn/stories/get_fields_info
 */
export async function fetchTapdStoryFieldsInfo(params: {
  workspaceId: string;
  token: string;
}): Promise<Record<string, unknown>> {
  const workspaceId = params.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("workspace_id 不能为空");
  }
  const parsed = await tapdGet(params.token, "/stories/get_fields_info", {
    workspace_id: workspaceId,
  });
  const data = parsed.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("TAPD 未返回需求字段信息");
  }
  return data as Record<string, unknown>;
}

/**
 * 在父需求下创建子需求。
 * @see https://open.tapd.cn/document/api-doc/API文档/api_reference/story/add_story.html
 */
export async function createTapdChildStory(params: {
  workspaceId: string;
  parentId: string;
  name: string;
  description: string;
  token: string;
  iterationId?: string;
  owner?: string;
}): Promise<TapdStoryItem> {
  const workspaceId = params.workspaceId.trim();
  const parentId = params.parentId.trim();
  const name = params.name.trim();
  const description = params.description.trim();
  if (!workspaceId || !parentId) {
    throw new Error("workspace_id 与 parent_id 不能为空");
  }
  if (!name) {
    throw new Error("子需求标题不能为空");
  }

  const body = new URLSearchParams({
    workspace_id: workspaceId,
    parent_id: parentId,
    name,
    description,
  });
  const iterationId = params.iterationId?.trim();
  if (iterationId) {
    body.set("iteration_id", iterationId);
  }
  const owner = params.owner?.trim();
  if (owner) {
    body.set("owner", owner);
  }

  const headers = {
    ...buildTapdAuthHeaders(params.token),
    "Content-Type": "application/x-www-form-urlencoded",
  };

  let res: Response;
  try {
    res = await fetch(`${TAPD_API_BASE}/stories`, {
      method: "POST",
      headers,
      body: body.toString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`TAPD 请求失败: ${msg}`);
  }

  const bodyText = await res.text();
  let parsed: TapdStoryCreateResponse;
  try {
    parsed = JSON.parse(bodyText) as TapdStoryCreateResponse;
  } catch {
    throw new Error(`TAPD 响应非 JSON（HTTP ${res.status}）`);
  }

  if (!res.ok || parsed.status !== 1) {
    throw new Error(parsed.info?.trim() || `TAPD HTTP ${res.status}`);
  }

  const story = parsed.data?.Story;
  if (!story || typeof story !== "object") {
    throw new Error("TAPD 创建成功但未返回需求数据");
  }
  const item = parseTapdStoryRow(story);
  if (!item) {
    throw new Error("TAPD 创建成功但返回数据不完整");
  }
  return normalizeTapdStoryItem(item, workspaceId);
}

async function tapdPostForm(
  token: string,
  path: string,
  body: URLSearchParams,
): Promise<TapdGenericResponse> {
  const headers = {
    ...buildTapdAuthHeaders(token),
    "Content-Type": "application/x-www-form-urlencoded",
  };
  let res: Response;
  try {
    res = await fetch(`${TAPD_API_BASE}${path}`, {
      method: "POST",
      headers,
      body: body.toString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`TAPD 请求失败: ${msg}`);
  }
  const bodyText = await res.text();
  return parseTapdGenericJsonResponse(bodyText, res.status);
}

function parseTapdTasksResponse(bodyText: string, httpStatus: number): TapdTasksResponse {
  let parsed: TapdTasksResponse;
  try {
    parsed = JSON.parse(bodyText) as TapdTasksResponse;
  } catch {
    throw new Error(`TAPD 响应非 JSON（HTTP ${httpStatus}）`);
  }
  if (!httpStatus || httpStatus < 400) {
    if (parsed.status !== 1) {
      throw new Error(parsed.info?.trim() || "TAPD 返回失败");
    }
    return parsed;
  }
  throw new Error(parsed.info?.trim() || `TAPD HTTP ${httpStatus}`);
}

async function tapdGetTasks(
  token: string,
  query: Record<string, string>,
): Promise<TapdTasksResponse> {
  const url = new URL(`${TAPD_API_BASE}/tasks`);
  for (const [key, val] of Object.entries(query)) {
    url.searchParams.set(key, val);
  }
  const headers = buildTapdAuthHeaders(token);
  let res: Response;
  try {
    res = await fetch(url.toString(), { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`TAPD 请求失败: ${msg}`);
  }
  const bodyText = await res.text();
  return parseTapdTasksResponse(bodyText, res.status);
}

function tasksResponseToItems(parsed: TapdTasksResponse): TapdTaskItem[] {
  const items: TapdTaskItem[] = [];
  for (const row of parsed.data ?? []) {
    const task = row?.Task;
    if (!task || typeof task !== "object") continue;
    const item = parseTapdTaskRow(task);
    if (item) items.push(item);
  }
  return items;
}

/**
 * 按 story_id 拉取关联任务列表。
 * @see https://api.tapd.cn/tasks
 */
export async function fetchTapdTasksByStory(params: {
  workspaceId: string;
  storyId: string;
  token: string;
}): Promise<TapdTaskItem[]> {
  const workspaceId = params.workspaceId.trim();
  const storyId = toTapdApiEntityId(params.storyId, workspaceId);
  if (!workspaceId || !storyId) {
    throw new Error("workspace_id 与 story_id 不能为空");
  }
  const parsed = await tapdGetTasks(params.token, {
    workspace_id: workspaceId,
    story_id: storyId,
    fields: "id,name,story_id,effort,status",
    limit: "200",
  });
  return tasksResponseToItems(parsed);
}

/**
 * 在需求下创建任务。
 * @see https://open.tapd.cn/document/api-doc/API文档/api_reference/task/add_task.html
 */
export async function createTapdTask(params: {
  workspaceId: string;
  storyId: string;
  name: string;
  token: string;
  effort?: string;
  owner?: string;
  /** 任务自定义字段 custom_field_one */
  customFieldOne?: string;
  /** 任务自定义字段 custom_field_two */
  customFieldTwo?: string;
  /** 任务自定义字段 custom_field_three */
  customFieldThree?: string;
  /** 预计开始，格式 YYYY-MM-DD */
  begin?: string;
  /** 预计结束，格式 YYYY-MM-DD */
  due?: string;
}): Promise<TapdTaskItem> {
  const workspaceId = params.workspaceId.trim();
  const name = params.name.trim();
  const storyId = toTapdApiEntityId(params.storyId, workspaceId);
  if (!workspaceId || !storyId || !name) {
    throw new Error("workspace_id、story_id 与任务标题不能为空");
  }

  const body = new URLSearchParams({
    workspace_id: workspaceId,
    name,
    story_id: storyId,
  });
  const effort = params.effort?.trim();
  if (effort) body.set("effort", effort);
  const owner = params.owner?.trim();
  if (owner) body.set("owner", owner);
  const customFieldOne = params.customFieldOne?.trim();
  if (customFieldOne) body.set("custom_field_one", customFieldOne);
  const customFieldTwo = params.customFieldTwo?.trim();
  if (customFieldTwo) body.set("custom_field_two", customFieldTwo);
  const customFieldThree = params.customFieldThree?.trim();
  if (customFieldThree) body.set("custom_field_three", customFieldThree);
  const begin = params.begin?.trim();
  if (begin) body.set("begin", begin);
  const due = params.due?.trim();
  if (due) body.set("due", due);

  const parsed = await tapdPostForm(params.token, "/tasks", body);
  const task = (parsed.data as { Task?: Record<string, unknown> } | undefined)?.Task;
  if (!task || typeof task !== "object") {
    throw new Error("TAPD 创建任务成功但未返回任务数据");
  }
  const item = parseTapdTaskRow(task);
  if (!item) {
    throw new Error("TAPD 创建任务成功但返回数据不完整");
  }
  return item;
}

/**
 * 新建花费工时。
 * @see https://open.tapd.cn/document/api-doc/API文档/api_reference/timesheet/add_timesheet.html
 */
export async function createTapdTimesheet(params: {
  workspaceId: string;
  entityType: "story" | "task";
  entityId: string;
  timespent: string;
  owner: string;
  token: string;
  spentdate?: string;
  memo?: string;
}): Promise<void> {
  const workspaceId = params.workspaceId.trim();
  const entityId = toTapdApiEntityId(params.entityId, workspaceId);
  const timespent = params.timespent.trim();
  const owner = params.owner.trim();
  if (!workspaceId || !entityId || !timespent || !owner) {
    throw new Error("workspace_id、entity_id、timespent 与 owner 不能为空");
  }

  const body = new URLSearchParams({
    workspace_id: workspaceId,
    entity_type: params.entityType,
    entity_id: entityId,
    timespent,
    owner,
  });
  const spentdate = params.spentdate?.trim();
  if (spentdate) body.set("spentdate", spentdate);
  const memo = params.memo?.trim();
  if (memo) body.set("memo", memo);

  await tapdPostForm(params.token, "/timesheets", body);
}

/**
 * 将需求标记为完成并回填完成工时。
 * @see https://open.tapd.cn/document/api-doc/API文档/api_reference/story/update_story.html
 */
export type TapdCommentItem = {
  id: string;
  description?: string;
  author?: string;
  entry_type?: string;
  entry_id?: string;
};

function parseTapdCommentRow(raw: Record<string, unknown>): TapdCommentItem | null {
  const id = readStoryField(raw, "id");
  if (!id) return null;
  return {
    id,
    description: readStoryField(raw, "description"),
    author: readStoryField(raw, "author"),
    entry_type: readStoryField(raw, "entry_type"),
    entry_id: readStoryField(raw, "entry_id"),
  };
}

/**
 * 在需求 / 任务 / 缺陷下新建评论。
 * @see https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/comment/add_comment.html
 */
export async function createTapdComment(params: {
  workspaceId: string;
  entryType: "stories" | "tasks" | "bug" | "bug_remark";
  entryId: string;
  description: string;
  author: string;
  token: string;
}): Promise<TapdCommentItem> {
  const workspaceId = params.workspaceId.trim();
  const entryId = toTapdApiEntityId(params.entryId, workspaceId);
  const description = params.description.trim();
  const author = params.author.trim();
  if (!workspaceId || !entryId || !description || !author) {
    throw new Error("workspace_id、entry_id、description 与 author 不能为空");
  }

  const body = new URLSearchParams({
    workspace_id: workspaceId,
    entry_type: params.entryType,
    entry_id: entryId,
    description,
    author,
  });

  const parsed = await tapdPostForm(params.token, "/comments", body);
  const comment = (parsed.data as { Comment?: Record<string, unknown> } | undefined)?.Comment;
  if (!comment || typeof comment !== "object") {
    throw new Error("TAPD 创建评论成功但未返回评论数据");
  }
  const item = parseTapdCommentRow(comment);
  if (!item) {
    throw new Error("TAPD 创建评论成功但返回数据不完整");
  }
  return item;
}

export async function completeTapdStory(params: {
  workspaceId: string;
  storyId: string;
  token: string;
  vStatus?: string;
  effortCompleted?: string;
}): Promise<TapdStoryItem> {
  const workspaceId = params.workspaceId.trim();
  const storyId = toTapdApiEntityId(params.storyId, workspaceId);
  if (!workspaceId || !storyId) {
    throw new Error("workspace_id 与 story_id 不能为空");
  }

  const body = new URLSearchParams({
    workspace_id: workspaceId,
    id: storyId,
  });
  const vStatus = params.vStatus?.trim();
  if (vStatus) body.set("v_status", vStatus);
  const effortCompleted = params.effortCompleted?.trim();
  if (effortCompleted) body.set("effort_completed", effortCompleted);

  const parsed = await tapdPostForm(params.token, "/stories", body);
  const story = (parsed.data as { Story?: Record<string, unknown> } | undefined)?.Story;
  if (!story || typeof story !== "object") {
    throw new Error("TAPD 更新需求成功但未返回需求数据");
  }
  const item = parseTapdStoryRow(story);
  if (!item) {
    throw new Error("TAPD 更新需求成功但返回数据不完整");
  }
  return normalizeTapdStoryItem(item, workspaceId);
}
