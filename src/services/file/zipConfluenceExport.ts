import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { ZipArchive } from "archiver";
import { getConfluenceOutRoot } from "./writeConfluenceMarkdown.js";

/** 将 `confluence_out/{subDir}/` 打包为同级 `{subDir}.zip` */
export async function zipConfluenceTreeDir(subDir: string): Promise<{ zipPath: string; zipName: string }> {
  const root = getConfluenceOutRoot();
  const sourceDir = join(root, subDir);
  const zipName = `${subDir}.zip`;
  const zipPath = join(root, zipName);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });

  return { zipPath, zipName };
}

/** 下载用文件名（含根 pageId 与标题） */
export function confluenceZipDownloadName(
  rootPageId: string,
  rootTitle: string,
  kind: "markdown" | "pdf" = "markdown",
): string {
  const safe = rootTitle
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80) || `tree_${rootPageId}`;
  const prefix = kind === "pdf" ? "confluence_pdf" : "confluence";
  return `${prefix}_${rootPageId}_${safe}.zip`;
}
