import type { DatabaseSync } from "node:sqlite";
import { resolveTapdToken } from "../dbConfig.js";
import {
  completeTapdStory,
  createTapdTask,
  createTapdTimesheet,
  fetchTapdTasksByStory,
  parseTapdStoryRef,
  type TapdTaskItem,
} from "../tools/tapdClient.js";

/** 故事完成时在需求下创建的任务标题后缀 */
export const TAPD_STORY_COMPLETE_TASK_SUFFIXES = ["设计", "开发", "自测"] as const;

export type TapdStoryCompleteTaskSuffix = (typeof TAPD_STORY_COMPLETE_TASK_SUFFIXES)[number];

/** @deprecated 使用 {@link TAPD_STORY_COMPLETE_TASK_SUFFIXES} */
export const TAPD_STORY_COMPLETE_TASK_NAMES = TAPD_STORY_COMPLETE_TASK_SUFFIXES;

/** 默认预估/花费工时（小时） */
export const DEFAULT_TAPD_STORY_COMPLETE_EFFORTS: Record<TapdStoryCompleteTaskSuffix, string> = {
  设计: "1",
  开发: "2",
  自测: "1",
};

/** 创建任务时 custom_field_one 取值（开发任务对应「研发」） */
export const TAPD_STORY_COMPLETE_TASK_CUSTOM_FIELD_ONE: Record<
  TapdStoryCompleteTaskSuffix,
  string
> = {
  设计: "设计",
  开发: "研发",
  自测: "自测",
};

/** 创建任务时 custom_field_two / custom_field_three 取值（仅研发类型设置） */
export const TAPD_STORY_COMPLETE_TASK_CUSTOM_FIELD_TWO: Record<
  TapdStoryCompleteTaskSuffix,
  string | undefined
> = {
  设计: undefined,
  开发: "后端AI",
  自测: undefined,
};

export const TAPD_STORY_COMPLETE_TASK_CUSTOM_FIELD_THREE: Record<
  TapdStoryCompleteTaskSuffix,
  string | undefined
> = {
  设计: undefined,
  开发: "0",
  自测: undefined,
};

/** 需求完成状态（中文工作流常见值，可通过参数覆盖） */
export const DEFAULT_TAPD_STORY_DONE_V_STATUS = "已实现";

export type TapdStoryCompleteTaskResult = {
  name: string;
  task_id: string;
  effort: string;
  timesheet_created: boolean;
};

export type TapdStoryCompleteResult = {
  workspace_id: string;
  story_id: string;
  story_name: string;
  local_task_title: string;
  story_v_status: string | null;
  effort_completed: string;
  tasks: TapdStoryCompleteTaskResult[];
};

function todaySpentDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 校验并归一化 spentdate（YYYY-MM-DD）；空则用当天 */
function resolveSpentDate(raw?: string): string {
  const value = raw?.trim();
  if (!value) return todaySpentDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("spentdate 格式须为 YYYY-MM-DD");
  }
  const [ys, ms, ds] = value.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const day = Number(ds);
  const d = new Date(y, m - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) {
    throw new Error("spentdate 不是有效日期");
  }
  return value;
}

function sumEfforts(efforts: string[]): string {
  const total = efforts.reduce((acc, raw) => {
    const n = Number(raw);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  return String(total);
}

function resolveEffortMap(
  overrides?: Partial<Record<TapdStoryCompleteTaskSuffix, string>>,
): Record<TapdStoryCompleteTaskSuffix, string> {
  return {
    设计: overrides?.设计?.trim() || DEFAULT_TAPD_STORY_COMPLETE_EFFORTS.设计,
    开发: overrides?.开发?.trim() || DEFAULT_TAPD_STORY_COMPLETE_EFFORTS.开发,
    自测: overrides?.自测?.trim() || DEFAULT_TAPD_STORY_COMPLETE_EFFORTS.自测,
  };
}

/** 任务标题：{本地父任务标题}-{后缀} */
export function buildStoryCompleteTaskName(
  localTaskTitle: string,
  suffix: TapdStoryCompleteTaskSuffix,
): string {
  const base = localTaskTitle.trim();
  return base ? `${base}-${suffix}` : suffix;
}

function buildStoryCompleteTaskNames(localTaskTitle: string): string[] {
  return TAPD_STORY_COMPLETE_TASK_SUFFIXES.map((suffix) =>
    buildStoryCompleteTaskName(localTaskTitle, suffix),
  );
}

function findDuplicateTaskNames(
  existing: TapdTaskItem[],
  expectedNames: readonly string[],
): string[] {
  const nameSet = new Set(expectedNames);
  const dup: string[] = [];
  for (const task of existing) {
    if (nameSet.has(task.name)) dup.push(task.name);
  }
  return dup;
}

/**
 * 在 TAPD 需求下创建「{本地任务标题}-设计 / -开发 / -自测」任务、填报工时，并将需求标记为完成。
 */
export async function completeTapdStoryWithStandardTasks(
  db: DatabaseSync,
  opts: {
    tapdTaskId: string;
    /** 本地 parent_task 标题，用于 TAPD 子任务命名 */
    localTaskTitle: string;
    creator: string;
    owner: string;
    efforts?: Partial<Record<TapdStoryCompleteTaskSuffix, string>>;
    storyDoneVStatus?: string;
    /** 任务起止日与工时花费日（YYYY-MM-DD），默认当天 */
    spentdate?: string;
  },
): Promise<TapdStoryCompleteResult> {
  const creator = opts.creator.trim();
  if (!creator) {
    throw new Error("creator 不能为空");
  }
  const owner = opts.owner.trim();
  if (!owner) {
    throw new Error("TAPD 花费人不能为空，请确认已登录并写入姓名");
  }

  const ref = parseTapdStoryRef(opts.tapdTaskId);
  if (!ref) {
    throw new Error("无法解析 TAPD 关联，格式须为 story={短ID}@tapd-{空间ID}");
  }

  const localTaskTitle = opts.localTaskTitle.trim();
  if (!localTaskTitle) {
    throw new Error("本地任务标题不能为空");
  }

  const token = resolveTapdToken(db, creator);
  if (!token) {
    throw new Error("未配置 TAPD Token，请在用户配置页设置");
  }

  const { workspaceId, storyId } = ref;
  const effortMap = resolveEffortMap(opts.efforts);
  const spentdate = resolveSpentDate(opts.spentdate);
  const storyDoneVStatus = opts.storyDoneVStatus?.trim() || DEFAULT_TAPD_STORY_DONE_V_STATUS;

  const expectedTaskNames = buildStoryCompleteTaskNames(localTaskTitle);

  const existingTasks = await fetchTapdTasksByStory({
    workspaceId,
    storyId,
    token,
  });
  const duplicates = findDuplicateTaskNames(existingTasks, expectedTaskNames);
  if (duplicates.length) {
    throw new Error(`该需求下已存在同名任务：${duplicates.join("、")}，请勿重复创建`);
  }

  const createdTasks: TapdStoryCompleteTaskResult[] = [];
  for (const suffix of TAPD_STORY_COMPLETE_TASK_SUFFIXES) {
    const name = buildStoryCompleteTaskName(localTaskTitle, suffix);
    const effort = effortMap[suffix];
    const task = await createTapdTask({
      workspaceId,
      storyId,
      name,
      token,
      effort,
      owner,
      customFieldOne: TAPD_STORY_COMPLETE_TASK_CUSTOM_FIELD_ONE[suffix],
      customFieldTwo: TAPD_STORY_COMPLETE_TASK_CUSTOM_FIELD_TWO[suffix],
      customFieldThree: TAPD_STORY_COMPLETE_TASK_CUSTOM_FIELD_THREE[suffix],
      begin: spentdate,
      due: spentdate,
    });
    let timesheetCreated = false;
    try {
      await createTapdTimesheet({
        workspaceId,
        entityType: "task",
        entityId: task.id,
        timespent: effort,
        owner,
        token,
        spentdate,
        memo: name,
      });
      timesheetCreated = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`任务「${name}」已创建，但填报工时失败：${msg}`);
    }
    createdTasks.push({
      name,
      task_id: task.id,
      effort,
      timesheet_created: timesheetCreated,
    });
  }

  const effortCompleted = sumEfforts(createdTasks.map((t) => t.effort));
  const updatedStory = await completeTapdStory({
    workspaceId,
    storyId,
    token,
    vStatus: storyDoneVStatus,
    effortCompleted,
  });

  return {
    workspace_id: workspaceId,
    story_id: updatedStory.id,
    story_name: updatedStory.name,
    local_task_title: localTaskTitle,
    story_v_status: storyDoneVStatus,
    effort_completed: effortCompleted,
    tasks: createdTasks,
  };
}
