/**
 * 从 `tasks.input_json` 构建占位符替换表（支持模板中 `{{key}}`）。
 * 仅处理 JSON 对象的顶层标量字段（字符串原样，数字/布尔转字符串）。
 */
function placeholderVarsFromInputJson(inputJson: string | null): Record<string, string> {
  if (!inputJson?.trim()) return {};
  try {
    const raw = JSON.parse(inputJson) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const o = raw as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(o)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string") out[key] = value;
      else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
      else if (Array.isArray(value)) out[key] = JSON.stringify(value);
    }
    return out;
  } catch {
    return {};
  }
}

/** 将模板中的 `{{field}}` 替换为 `input_json` 同名字段；未命中则替换为空串 */
export function applyInputJsonPlaceholders(template: string, inputJson: string | null): string {
  const vars = placeholderVarsFromInputJson(inputJson);
  return template.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_match, key: string) => vars[key] ?? "");
}
