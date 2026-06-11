import { z } from "zod";
import { isTaskType, type TaskType } from "../constants/taskType.js";

export const zTaskType = z.coerce
  .number()
  .int()
  .refine((n): n is TaskType => isTaskType(n), {
    message: "invalid task_type (expected 0–13, 20–22, or 101–104)",
  });

export const zTaskTypeOptional = zTaskType.optional();
