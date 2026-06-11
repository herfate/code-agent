/**
 * OCR.space API（Engine 3）封装。
 * 替代本地 tesseract.js，调用在线 OCR.space `parse/image` 接口，使用 OCREngine=3。
 * 文档：https://ocr.space/ocrapi
 *
 * 配置：
 *   OCR_SPACE_API_KEY  必填，免费 key 可在 https://ocr.space/ocrapi 注册（Free：25,000 次/月 + Engine 3 额外 2,500 次/月）
 *   OCR_SPACE_API_URL  可选，PRO 线路会使用专属端点；默认为官方免费端点
 *
 * Engine 3 特性：200+ 语言自动检测、手写、表格（返回 Markdown）、精度最高；缺点是较慢、额度较低。
 */

export type OcrResult = {
  text: string;
  confidence: number;
};

export type OcrImageBuffersResult = {
  results: Map<string, OcrResult>;
  /** 单张图片识别失败不会中断整批，错误信息收集到这里，供上层作为 warning 上报 */
  warnings: string[];
};

export type OcrImageBuffersOpts = {
  /** OCR 语言（3 字母代码，如 chs/cht/eng/jpn）；Engine 3 默认 auto 自动检测 */
  language?: string;
  /** OCR 引擎，默认 "3" */
  ocrEngine?: string;
  /** 并发上限；Engine 3 Free 计划仅允许 1 个并发，默认 1，PRO 可调高 */
  concurrency?: number;
  /** 表格/票据类输入，按行结构化输出（Engine 3 返回 Markdown 表格）；默认 true */
  isTable?: boolean;
  /** 相邻两次识别请求之间的间隔（毫秒），避免过快触发 OCR.space 频率限制；默认 1500ms，传 0 关闭 */
  delayMs?: number;
};

const DEFAULT_LANGUAGE = "auto";
const DEFAULT_OCR_ENGINE = "3";
/** Engine 3 Free 计划并发上限为 1，默认串行 */
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_ENDPOINT = "https://api.ocr.space/parse/image";
/** Engine 3 处理大图较慢，给足超时 */
const REQUEST_TIMEOUT_MS = 90_000;
/** 默认请求间隔：OCR.space Free 限制 500 次/天/IP，留出缓冲 */
const DEFAULT_DELAY_MS = 1500;
/** Engine 3 Free 限流（HTTP 552）最大重试次数 */
const RATE_LIMIT_MAX_RETRIES = 4;
/** 限流重试退避基数（毫秒）：3s → 6s → 12s → 24s 指数退避 */
const RATE_LIMIT_BASE_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 是否为 Engine 3 Free 限流错误（HTTP 552 / E552） */
function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /HTTP 552|E552|Rate limit exceeded/i.test(msg);
}

/** OCR.space 不支持的输入格式（矢量图 / 未列出的位图格式），跳过避免浪费额度 */
const OCR_SPACE_UNSUPPORTED_EXT = /\.(svg|webp|ico|heic|heif|avif)$/i;

/** 是否跳过 OCR（SVG/WEBP 等格式 OCR.space 无法处理） */
export function shouldSkipImageOcr(filename: string): boolean {
  return OCR_SPACE_UNSUPPORTED_EXT.test(filename);
}

/** 根据文件名推断 MIME（base64Image data-uri 前缀 + 可选 filetype 覆盖自动识别） */
function guessImageMeta(
  filename: string,
): { mime: string; filetype?: string } | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png":
      return { mime: "image/png", filetype: "PNG" };
    case "jpg":
    case "jpeg":
      return { mime: "image/jpeg", filetype: "JPG" };
    case "gif":
      return { mime: "image/gif", filetype: "GIF" };
    case "tif":
    case "tiff":
      return { mime: "image/tiff", filetype: "TIF" };
    case "bmp":
      return { mime: "image/bmp", filetype: "BMP" };
    case "pdf":
      return { mime: "application/pdf", filetype: "PDF" };
    default:
      return null;
  }
}

type OcrSpaceResponse = {
  ParsedResults?: Array<{
    ParsedText?: string | null;
    FileParseExitCode?: string | number | null;
    ErrorMessage?: string | null;
    ErrorDetails?: string | null;
  } | null>;
  OCRExitCode?: string | number;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | null;
  ErrorDetails?: string | null;
};

function resolveApiKey(): string {
  const apiKey = (process.env.OCR_SPACE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OCR_SPACE_API_KEY_MISSING");
  }
  return apiKey;
}

function resolveEndpoint(): string {
  return (process.env.OCR_SPACE_API_URL ?? DEFAULT_ENDPOINT).trim();
}

/** 单张图片调用 OCR.space */
async function ocrSingle(
  item: { key: string; buffer: Buffer },
  apiKey: string,
  endpoint: string,
  opts: { language: string; ocrEngine: string; isTable: boolean },
): Promise<OcrResult> {
  const meta = guessImageMeta(item.key);
  const mime = meta?.mime ?? "image/png";
  const base64 = item.buffer.toString("base64");
  const base64Image = `data:${mime};base64,${base64}`;

  const form = new FormData();
  form.append("base64Image", base64Image);
  form.append("language", opts.language);
  form.append("OCREngine", opts.ocrEngine);
  form.append("isOverlayRequired", "false");
  form.append("scale", "true");
  if (meta?.filetype) form.append("filetype", meta.filetype);
  if (opts.isTable) form.append("isTable", "true");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: apiKey },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* 忽略响应体读取失败 */
    }
    throw new Error(`OCR.space HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  let json: OcrSpaceResponse;
  try {
    json = (await res.json()) as OcrSpaceResponse;
  } catch (e) {
    throw new Error(`OCR.space 响应解析失败：${e instanceof Error ? e.message : String(e)}`);
  }

  if (json.IsErroredOnProcessing) {
    const msg = json.ErrorMessage ?? json.ErrorDetails ?? "未知错误";
    throw new Error(`OCR.space 处理失败：${msg}`);
  }

  const exitCode = Number(json.OCRExitCode ?? 1);
  // 1=成功 2=部分成功；3=全部失败 4=致命错误 —— 后两者视为本次识别失败
  if (exitCode === 3 || exitCode === 4) {
    const msg = json.ErrorMessage ?? json.ErrorDetails ?? `OCRExitCode=${exitCode}`;
    throw new Error(`OCR.space 识别失败：${msg}`);
  }

  const text = (json.ParsedResults ?? [])
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => r.ParsedText ?? "")
    .join("\n")
    .replace(/\r/g, "")
    .trim();

  return { text, confidence: text ? 100 : 0 };
}

/**
 * 单张图片调用 OCR.space，遇到 Engine 3 Free 限流（552）时指数退避重试。
 * 缺 key 等非限流错误不重试，直接抛出。
 */
async function ocrSingleWithRetry(
  item: { key: string; buffer: Buffer },
  apiKey: string,
  endpoint: string,
  opts: { language: string; ocrEngine: string; isTable: boolean },
): Promise<OcrResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await ocrSingle(item, apiKey, endpoint, opts);
    } catch (e) {
      // 缺 key 属于配置错误，不重试
      if (e instanceof Error && e.message === "OCR_SPACE_API_KEY_MISSING") throw e;
      lastErr = e;
      // 非限流错误或已达最大重试次数，直接抛出
      if (!isRateLimitError(e) || attempt === RATE_LIMIT_MAX_RETRIES) throw e;
      await sleep(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw lastErr;
}

/**
 * 对多张图片批量 OCR（OCR.space Engine 3），受控并发。
 * 单张失败不会中断整批：失败图片记为空文本，错误写入 warnings。
 * 缺少 API key 时抛出 OCR_SPACE_API_KEY_MISSING，由上层转为 503。
 */
export async function ocrImageBuffers(
  items: Array<{ key: string; buffer: Buffer }>,
  opts?: OcrImageBuffersOpts,
): Promise<OcrImageBuffersResult> {
  const results = new Map<string, OcrResult>();
  const warnings: string[] = [];
  if (items.length === 0) return { results, warnings };

  const apiKey = resolveApiKey();
  const endpoint = resolveEndpoint();
  const singleOpts = {
    language: opts?.language ?? DEFAULT_LANGUAGE,
    ocrEngine: opts?.ocrEngine ?? DEFAULT_OCR_ENGINE,
    isTable: opts?.isTable ?? true,
  };
  const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY);
  const delayMs = Math.max(0, opts?.delayMs ?? DEFAULT_DELAY_MS);

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      try {
        const result = await ocrSingleWithRetry(item, apiKey, endpoint, singleOpts);
        results.set(item.key, result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 缺 key 属于整批级配置错误，直接抛出
        if (msg === "OCR_SPACE_API_KEY_MISSING") throw e;
        results.set(item.key, { text: "", confidence: 0 });
        warnings.push(`${item.key}: ${msg}`);
      }
      // 相邻请求之间留出间隔（仍有待处理项时才等待，避免末尾多余等待）
      if (delayMs > 0 && cursor < items.length) {
        await sleep(delayMs);
      }
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(pool);

  return { results, warnings };
}
