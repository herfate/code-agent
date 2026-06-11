import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { testCaseDesignToExcelBuffer } from "../services/file/exportTestCaseDesignToExcel.js";
import {
  parseTestCaseDesignContent,
  testCaseDesignExcelFilename,
} from "../services/file/parseTestCaseDesignJson.js";
import { contentDispositionAttachment } from "../services/file/contentDisposition.js";

const zExportTestCaseDesignBody = z.object({
  content: z.string().min(1),
  filename: z.string().max(255).optional(),
});

/** 工具类导出接口（JSON 内容直转 Excel） */
export function registerExportToolsRoutes(app: FastifyInstance): void {
  /** 将功能测试用例设计 JSON 转为 Excel 下载 */
  app.post("/api/export/test-case-design-excel", async (request, reply) => {
    const parsed = zExportTestCaseDesignBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const doc = parseTestCaseDesignContent(parsed.data.content);
    if (!doc) {
      return reply.status(400).send({
        error: "not a test case design json (requires cases[] with test scenario fields or columns[])",
      });
    }
    if (doc.cases.length === 0) {
      return reply.status(400).send({ error: "cases is empty" });
    }

    try {
      const buf = await testCaseDesignToExcelBuffer(doc);
      const filename = testCaseDesignExcelFilename(parsed.data.filename);
      reply.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      reply.header("Content-Disposition", contentDispositionAttachment(filename));
      return reply.send(buf);
    } catch (err) {
      request.log.error(err, "export test case design excel failed");
      return reply.status(500).send({ error: "export excel failed" });
    }
  });
}
