/** 净化文件名片段（保留中文，替换 Windows 非法字符） */
export function sanitizeFilenameSegment(name: string, maxLen = 80): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, maxLen);
}

/** 在 Excel 下载文件名前加上父任务标题前缀：`{title}_{base}` */
export function exportExcelFilenameWithTitle(
  title: string | undefined | null,
  baseFilename: string,
): string {
  const base = baseFilename.trim() || "export.xlsx";
  const safeTitle = title ? sanitizeFilenameSegment(title) : "";
  if (!safeTitle) return base;
  return `${safeTitle}_${base}`;
}
