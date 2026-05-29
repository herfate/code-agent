import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFXMARK_SCRIPT = join(__dirname, "../../../scripts/cfxmark_to_md.py");

/** Windows：cmd 找不到命令时常返回 9009 */
const WIN_CMD_NOT_FOUND = 9009;

export type CfxmarkConvertResult = {
  markdown: string;
  warnings: string[];
};

let cachedPython: string | undefined;

/**
 * 解析 cfxmark 用的 Python 可执行文件。
 * 优先 `CFXMARK_PYTHON` / `PYTHON_PATH`；Windows 下自动跳过 Store 占位符与 pyenv `.bat` shim。
 */
export function resolveCfxmarkPython(): string {
  if (cachedPython) return cachedPython;

  const fromEnv = (process.env.CFXMARK_PYTHON ?? process.env.PYTHON_PATH ?? "").trim();
  if (fromEnv) {
    cachedPython = fromEnv;
    return fromEnv;
  }

  if (process.platform === "win32") {
    const detected = detectWindowsPython();
    if (detected) {
      cachedPython = detected;
      return detected;
    }
  }

  cachedPython = "python3";
  return cachedPython;
}

function detectWindowsPython(): string | undefined {
  try {
    const out = execFileSync("where.exe", ["python"], { encoding: "utf8", windowsHide: true });
    const lines = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // 优先真实 python.exe，跳过 WindowsApps 占位符与 pyenv shim
    const preferred = lines.find(
      (p) =>
        /\.exe$/i.test(p) &&
        !/WindowsApps/i.test(p) &&
        !/pyenv-win[\\/]shims/i.test(p),
    );
    if (preferred && existsSync(preferred)) return preferred;

    const anyExe = lines.find((p) => /\.exe$/i.test(p) && !/WindowsApps/i.test(p));
    if (anyExe && existsSync(anyExe)) return anyExe;
  } catch {
    /* where 失败则尝试常见安装路径 */
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    for (const ver of ["Python313", "Python312", "Python311", "Python310"]) {
      const candidate = join(localAppData, "Programs", "Python", ver, "python.exe");
      if (existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

function formatSpawnFailure(python: string, code: number | null, stderr: string): string {
  const cliMsg = parseCfxmarkCliError(stderr);
  if (cliMsg) return cliMsg;

  if (code === WIN_CMD_NOT_FOUND || code === 1) {
    return (
      `未找到可用的 Python（尝试: ${python}）。Windows 上请在 .env 设置 CFXMARK_PYTHON 为 python.exe 完整路径，` +
      `例如 C:\\Users\\你\\AppData\\Local\\Programs\\Python\\Python310\\python.exe，` +
      `并执行 pip install -r requirements-cfxmark.txt（需 Python ≥ 3.10）`
    );
  }

  return code === null ? "cfxmark 进程异常退出" : `cfxmark 退出码 ${code}`;
}

/** 去掉 lone UTF-16 surrogate，避免传给 Python 后 UTF-8 编码失败 */
export function stripUnicodeSurrogates(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

/**
 * 去掉 cfxmark 为 Confluence 往返保留的内部标记（opaque 块、payloads 侧车、内联 cfx: 链接等）。
 * 仅适用于单向导出阅读，处理后不可再 to_cfx 回写 Confluence。
 */
export function stripCfxmarkExportArtifacts(markdown: string): string {
  let md = markdown;

  md = md.replace(/<!--\s*cfxmark:notice[\s\S]*?-->\s*/g, "");
  md = md.replace(
    /<!--\s*cfxmark:opaque[^>]*-->\s*```cfx-storage[\s\S]*?```\s*<!--\s*\/cfxmark:opaque\s*-->\s*/g,
    "",
  );
  md = md.replace(
    /<!--\s*cfxmark:payloads\s*-->[\s\S]*?<!--\s*\/cfxmark:payloads\s*-->\s*/g,
    "",
  );
  md = md.replace(/\[[^\]]*\]\(cfx:[^)]+\)/g, "");
  md = md.replace(/<!--\s*cfxmark:asset[^>]*-->/g, "");
  md = md.replace(/#cfxmark:[^\s")]+/g, "");
  md = md.replace(/\n{3,}/g, "\n\n");

  return md.trimEnd();
}

/**
 * 依赖：`pip install -r requirements-cfxmark.txt`（Python ≥ 3.10）。
 */
export function storageXhtmlToMarkdownWithCfxmark(storageXhtml: string): Promise<CfxmarkConvertResult> {
  const python = resolveCfxmarkPython();

  return new Promise((resolve, reject) => {
    const child = spawn(python, [CFXMARK_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("cfxmark 转换超时（120s）"));
    }, 120_000);

    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `未找到 Python 可执行文件 (${python})；请在 .env 设置 CFXMARK_PYTHON 为 python.exe 完整路径`,
          ),
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(formatSpawnFailure(python, code, stderr)));
        return;
      }

      try {
        resolve(parseCfxmarkStdout(stdout, stderr));
      } catch (e) {
        reject(e);
      }
    });

    child.stdin.write(stripUnicodeSurrogates(storageXhtml), "utf8");
    child.stdin.end();
  });
}

function parseCfxmarkStdout(stdout: string, stderr: string): CfxmarkConvertResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(parseCfxmarkCliError(stderr) ?? "cfxmark 无输出");
  }

  let parsed: { markdown?: string; warnings?: unknown; error?: string };
  try {
    parsed = JSON.parse(trimmed) as { markdown?: string; warnings?: unknown; error?: string };
  } catch {
    throw new Error(`cfxmark 输出非 JSON: ${trimmed.slice(0, 200)}`);
  }

  if (typeof parsed.markdown !== "string") {
    throw new Error(parsed.error ?? "cfxmark 未返回 markdown");
  }

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === "string")
    : [];

  return { markdown: stripCfxmarkExportArtifacts(parsed.markdown), warnings };
}

function parseCfxmarkCliError(stderr: string): string | undefined {
  const t = stderr.trim();
  if (!t) return undefined;
  try {
    const obj = JSON.parse(t) as { error?: string };
    if (obj.error) return obj.error;
  } catch {
    return t.slice(0, 500);
  }
  return undefined;
}
