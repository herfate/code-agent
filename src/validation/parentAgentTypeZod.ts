import { z } from "zod";
import { isParentAgentType, type ParentAgentType } from "../constants/parentAgentType.js";

export const zParentAgentType = z.coerce
  .number()
  .int()
  .refine((n): n is ParentAgentType => isParentAgentType(n), {
    message:
      "invalid parent task_type (1 开发自测Agent / 2 开发自Review Agent / 3 功能测试Agent / 4 业务Agent / 5 测试案例编排Agent / 6 自动化测试Agent / 7 沉淀记忆Agent)",
  });

export const zParentAgentTypeOptional = zParentAgentType.optional();
