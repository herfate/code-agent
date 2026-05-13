import { z } from "zod";
import { isTaskType, type TaskType } from "../constants/taskType.js";

export const zTaskType = z.coerce
  .number()
  .int()
  .refine((n): n is TaskType => isTaskType(n), {
    message: "invalid task_type (expected 0–7 or 101)",
  });

export const zTaskTypeOptional = zTaskType.optional();
