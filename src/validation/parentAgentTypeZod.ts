import { z } from "zod";
import { isParentAgentType, type ParentAgentType } from "../constants/parentAgentType.js";

export const zParentAgentType = z.coerce
  .number()
  .int()
  .refine((n): n is ParentAgentType => isParentAgentType(n), {
    message: "invalid parent task_type (expected 1 for 开发自测Agent or 2 for 开发自Review Agent)",
  });

export const zParentAgentTypeOptional = zParentAgentType.optional();
