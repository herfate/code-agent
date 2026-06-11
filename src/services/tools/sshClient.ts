import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import "dotenv/config";

const DEFAULT_PORT = 22;
export const DEFAULT_READY_TIMEOUT_MS = 20_000;
export const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const BASTION_SHELL_EOL = "\r";

/** 经堡垒机 SSH 穿透登录的目标主机（齐治/SSHD：用户名 `{堡垒机用户}@{目标账号}@{目标IP}`） */
export type SshBastionTarget = {
  host: string;
  user: string;
};

/** SSH 连接参数（密码或私钥至少配置其一） */
export type SshConnectOptions = {
  host: string;
  port?: number;
  username: string;
  /** 密码认证 */
  password?: string;
  /** 私钥 PEM 内容或本机私钥文件路径 */
  privateKey?: string | Buffer;
  /** 私钥口令 */
  passphrase?: string;
  /** 经堡垒机穿透到内网目标；设置后仍连 `host`/`port`，但 SSH 用户名会改写 */
  bastionTarget?: SshBastionTarget;
  /** 握手超时（毫秒） */
  readyTimeout?: number;
  signal?: AbortSignal;
};

export type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type SshExecOptions = {
  signal?: AbortSignal;
  /** 命令执行超时（毫秒） */
  timeoutMs?: number;
};

export type BastionMenuSelectOptions = {
  /** 搜索 IP / 主机名 / label 关键字 */
  keyword: string;
  /** 搜索结果序号，默认 1 */
  pickIndex?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 齐治/SSHD 堡垒机穿透用户名：`{bastionUser}@{targetUser}@{targetHost}` */
export function buildBastionPierceUsername(
  bastionUser: string,
  target: SshBastionTarget,
): string {
  const user = bastionUser.trim();
  const targetUser = target.user.trim();
  const targetHost = target.host.trim();
  if (!user || !targetUser || !targetHost) {
    throw new Error("buildBastionPierceUsername: bastionUser、target.user、target.host 均不能为空");
  }
  return `${user}@${targetUser}@${targetHost}`;
}

function resolveConnectUsername(options: SshConnectOptions): string {
  if (options.bastionTarget) {
    return buildBastionPierceUsername(options.username, options.bastionTarget);
  }
  return options.username.trim();
}

function buildConnectConfig(options: SshConnectOptions): ConnectConfig {
  const host = options.host.trim();
  if (!host) {
    throw new Error("SSH host 不能为空");
  }
  const username = resolveConnectUsername(options);
  if (!username) {
    throw new Error("SSH username 不能为空");
  }

  const config: ConnectConfig = {
    host,
    port: options.port ?? DEFAULT_PORT,
    username,
    readyTimeout: options.readyTimeout ?? DEFAULT_READY_TIMEOUT_MS,
    // 齐治/SSHD 堡垒机通常需要 password + keyboard-interactive
    tryKeyboard: Boolean(options.password?.trim()),
    algorithms: {
      serverHostKey: ["ssh-rsa", "rsa-sha2-512", "rsa-sha2-256", "ssh-ed25519"],
    },
  };

  const password = options.password?.trim();
  if (password) {
    config.password = password;
  }
  if (options.privateKey != null) {
    config.privateKey = resolvePrivateKeyMaterial(options.privateKey);
    const passphrase = options.passphrase?.trim();
    if (passphrase) {
      config.passphrase = passphrase;
    }
  }

  if (!config.password && !config.privateKey) {
    throw new Error("SSH 需配置 password 或 privateKey 之一");
  }

  return config;
}

/**
 * 解析私钥：已是 PEM 内容则原样返回，否则按文件路径读取。
 * 返回值可能含敏感信息，勿写入日志。
 */
export function resolvePrivateKeyMaterial(keyOrPath: string | Buffer): string | Buffer {
  if (Buffer.isBuffer(keyOrPath)) {
    return keyOrPath;
  }
  const trimmed = keyOrPath.trim();
  if (
    trimmed.startsWith("-----BEGIN") ||
    trimmed.includes("BEGIN OPENSSH PRIVATE KEY") ||
    trimmed.includes("BEGIN RSA PRIVATE KEY")
  ) {
    return trimmed;
  }
  if (existsSync(trimmed)) {
    return readFileSync(trimmed);
  }
  return trimmed;
}

function normalizeSshError(err: unknown, config: ConnectConfig, action: string): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const host = config.host ?? "?";
  const port = config.port ?? DEFAULT_PORT;
  if (msg.includes("All configured authentication methods failed")) {
    const userHint = config.username ? `，用户名 ${config.username}` : "";
    return new Error(
      `SSH ${host}:${port} 认证失败${userHint}：密码错误或账号被临时锁定（连续失败后需等待 5～15 分钟）。请先用 Xshell 验证堡垒机账号。`,
    );
  }
  return new Error(`SSH ${host}:${port} ${action}失败: ${msg}`);
}

function isAuthFailedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("All configured authentication methods failed") || msg.includes("认证失败");
}

/** 堡垒机常用 keyboard-interactive；密码与 prompts 数量对齐回填 */
function attachKeyboardInteractiveAuth(client: Client, password: string): void {
  client.on("keyboard-interactive", (_name, _instr, _lang, prompts, finish) => {
    finish(prompts.map(() => password));
  });
}

function isExecNotSupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Unable to exec") || msg.includes("Unable to open shell");
}

function sftpProbeOnClient(client: Client): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`SSH SFTP 探测失败: ${err.message}`));
        return;
      }
      sftp.realpath(".", (realpathErr) => {
        if (realpathErr) {
          reject(new Error(`SSH SFTP 探测失败: ${realpathErr.message}`));
          return;
        }
        resolve();
      });
    });
  });
}

/** 已建立的 SSH 会话，可在同一连接上多次 exec */
export type SshSession = {
  exec: (command: string, opts?: SshExecOptions) => Promise<SshExecResult>;
  probeSftp: () => Promise<void>;
  close: () => void;
};

/** 堡垒机交互菜单会话：先 selectTarget，再 exec */
export type BastionMenuSession = SshSession & {
  selectTarget: (select: BastionMenuSelectOptions) => Promise<void>;
};

function hasRemoteShellPrompt(buf: string): boolean {
  return (
    buf.includes("Last login") ||
    buf.includes("验证成功") ||
    hasInteractiveShellReady(buf)
  );
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\][^\u0007]*\u0007/g, "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** 可输入命令的 shell 提示符（须等到 `$`/`#`，不能只用登录横幅） */
function hasInteractiveShellReady(buf: string): boolean {
  const plain = stripAnsi(buf);
  return /~\]\$\s*$/.test(plain) || /~\]\#\s*$/.test(plain) || /[\]$#]\s*$/.test(plain);
}

function isMarkerLineComplete(buf: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\r\n])${escaped}[\r\n]`).test(buf);
}

function hasBastionMenuPrompt(buf: string): boolean {
  return /[\r\n]> $/.test(buf) || buf.endsWith("> ");
}

async function waitForBuffer(
  getBuf: () => string,
  predicate: () => boolean,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(150);
  }
  throw new Error(`${timeoutMessage}: ${getBuf().slice(-400)}`);
}

function execViaShellOnClient(
  client: Client,
  command: string,
  opts?: SshExecOptions,
): Promise<SshExecResult> {
  const cmd = command.trim();
  if (!cmd) {
    throw new Error("SSH shell exec: command 不能为空");
  }

  return new Promise((resolve, reject) => {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    let stream: ClientChannel | undefined;
    let settled = false;
    let buf = "";
    let commandSent = false;
    const marker = `__SSH_DONE_${Date.now()}__`;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      stream?.end();
      fail(new Error("SSH shell 命令执行已取消"));
    };

    if (opts?.signal?.aborted) {
      fail(new Error("SSH shell 命令执行已取消"));
      return;
    }
    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    timer = setTimeout(() => fail(new Error(`SSH shell 命令超时（${timeoutMs}ms）`)), timeoutMs);

    client.shell({ term: "xterm-256color", cols: 120, rows: 30 }, (err, shellStream) => {
      if (err) {
        fail(new Error(`SSH shell 失败: ${err.message}`));
        return;
      }
      stream = shellStream;

      const tryFinish = () => {
        if (!commandSent || !isMarkerLineComplete(buf, marker)) return;
        const markerIdx = buf.lastIndexOf(marker);
        const stdout = filterShellCommandOutput(buf.slice(0, markerIdx), cmd, marker);
        settled = true;
        cleanup();
        resolve({ stdout, stderr: "", exitCode: 0 });
      };

      shellStream.on("data", (data: Buffer) => {
        buf += data.toString("utf8");
        if (!commandSent && hasInteractiveShellReady(buf)) {
          commandSent = true;
          shellStream.write(`${cmd}; echo ${marker}${BASTION_SHELL_EOL}`);
        }
        tryFinish();
      });
      shellStream.stderr.on("data", (data: Buffer) => {
        buf += data.toString("utf8");
        tryFinish();
      });
      shellStream.on("close", () => {
        if (!settled) fail(new Error("SSH shell 意外关闭"));
      });
    });
  });
}

function execViaShellStream(
  stream: ClientChannel,
  getBuf: () => string,
  command: string,
  opts?: SshExecOptions,
): Promise<SshExecResult> {
  const cmd = command.trim();
  if (!cmd) {
    throw new Error("SSH shell exec: command 不能为空");
  }

  return new Promise((resolve, reject) => {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const marker = `__SSH_DONE_${Date.now()}__`;
    const startLen = getBuf().length;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => fail(new Error("SSH shell 命令执行已取消"));
    if (opts?.signal?.aborted) {
      fail(new Error("SSH shell 命令执行已取消"));
      return;
    }
    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    timer = setTimeout(() => fail(new Error(`SSH shell 命令超时（${timeoutMs}ms）`)), timeoutMs);

    const onData = () => {
      const delta = getBuf().slice(startLen);
      if (!isMarkerLineComplete(delta, marker)) return;
      cleanup();
      settled = true;
      const beforeMarker = delta.slice(0, delta.lastIndexOf(marker));
      const stdout = filterShellCommandOutput(beforeMarker, cmd, marker);
      resolve({ stdout, stderr: "", exitCode: 0 });
    };

    stream.on("data", onData);
    stream.write(`${cmd}; echo ${marker}${BASTION_SHELL_EOL}`);
  });
}

function isPierceExecBannerOnly(result: SshExecResult, command: string): boolean {
  const out = result.stdout;
  if (out.includes("Welcome to SSHD") || out.includes("正在连接")) {
    return true;
  }
  const cmd = command.trim();
  if (cmd === "echo ok" && !/\bok\b/.test(out)) {
    return true;
  }
  return result.exitCode === 0 && out.includes("Last login") && !out.includes(cmd);
}

function filterShellCommandOutput(chunk: string, cmd: string, marker: string): string {
  const bannerHints = [
    "Welcome to SSHD",
    "user login success",
    "正在连接",
    "资源已被管控",
    "验证成功",
    "Last login",
  ];
  return stripAnsi(chunk)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const t = line.trim();
      if (!t || t.includes(marker) || t.includes(cmd)) return false;
      if (/^[^\s]+@[^\s]+[\]$#]?$/.test(t)) return false;
      return !bannerHints.some((hint) => t.includes(hint));
    })
    .join("\n")
    .trim();
}

function createSession(
  client: Client,
  options: { shellFallback?: boolean; shellOnly?: boolean } = {},
): SshSession {
  const { shellFallback = false, shellOnly = false } = options;
  return {
    exec: async (command, opts) => {
      if (shellOnly) {
        return execViaShellOnClient(client, command, opts);
      }
      try {
        const result = await execOnClient(client, command, opts);
        if (shellFallback && isPierceExecBannerOnly(result, command)) {
          return execViaShellOnClient(client, command, opts);
        }
        return result;
      } catch (e) {
        if (!shellFallback || !isExecNotSupportedError(e)) throw e;
        return execViaShellOnClient(client, command, opts);
      }
    },
    probeSftp: () => sftpProbeOnClient(client),
    close: () => {
      try {
        client.end();
      } catch {
        /* 忽略重复关闭 */
      }
    },
  };
}

function execOnClient(client: Client, command: string, opts?: SshExecOptions): Promise<SshExecResult> {
  const cmd = command.trim();
  if (!cmd) {
    throw new Error("SSH exec: command 不能为空");
  }

  return new Promise((resolve, reject) => {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    let stream: ClientChannel | undefined;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      stream?.close();
      stream?.destroy();
      fail(new Error("SSH 命令执行已取消"));
    };

    if (opts?.signal?.aborted) {
      fail(new Error("SSH 命令执行已取消"));
      return;
    }
    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    timer = setTimeout(() => {
      stream?.close();
      stream?.destroy();
      fail(new Error(`SSH 命令执行超时（${timeoutMs}ms）`));
    }, timeoutMs);

    client.exec(cmd, (err, execStream) => {
      if (err) {
        const hint = isExecNotSupportedError(err)
          ? "（堡垒机通常不支持 exec，请配置 bastionTarget 穿透到内网，或使用 connectBastionMenuSession）"
          : "";
        fail(new Error(`SSH exec 失败: ${err.message}${hint}`));
        return;
      }
      stream = execStream;
      const chunks: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };

      execStream
        .on("close", (code: number | null) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            stdout: Buffer.concat(chunks.stdout).toString("utf8"),
            stderr: Buffer.concat(chunks.stderr).toString("utf8"),
            exitCode: code,
          });
        })
        .on("data", (data: Buffer) => chunks.stdout.push(data))
        .stderr.on("data", (data: Buffer) => chunks.stderr.push(data));
    });
  });
}

/** 建立 SSH 连接并返回可复用的会话 */
export function connectSsh(options: SshConnectOptions): Promise<SshSession> {
  const config = buildConnectConfig(options);
  const client = new Client();
  const outerSignal = options.signal;
  const password = options.password?.trim();
  if (password) {
    attachKeyboardInteractiveAuth(client, password);
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanupAbort = () => {
      outerSignal?.removeEventListener("abort", onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const onAbort = () => {
      fail(new Error("SSH 连接已取消"));
    };

    if (outerSignal?.aborted) {
      fail(new Error("SSH 连接已取消"));
      return;
    }
    outerSignal?.addEventListener("abort", onAbort, { once: true });

    client
      .on("ready", () => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        resolve(createSession(client, {
          shellFallback: Boolean(options.bastionTarget),
          shellOnly: Boolean(options.bastionTarget),
        }));
      })
      .on("error", (err) => {
        fail(normalizeSshError(err, config, "连接"));
      })
      .connect(config);
  });
}

/** 经堡垒机穿透连接内网目标（用户名 `{堡垒机用户}@{目标账号}@{目标IP}`） */
export function connectSshThroughBastion(
  bastion: SshConnectOptions,
  target: SshBastionTarget,
): Promise<SshSession> {
  return connectSsh({ ...bastion, bastionTarget: target });
}

/**
 * 打开堡垒机交互菜单（shell），手动或自动选资源后在目标机执行命令。
 * 若已知目标 IP/账号，优先使用 {@link connectSshThroughBastion}。
 */
export function connectBastionMenuSession(options: SshConnectOptions): Promise<BastionMenuSession> {
  const config = buildConnectConfig({ ...options, bastionTarget: undefined });
  const client = new Client();
  const password = options.password?.trim();
  if (password) {
    attachKeyboardInteractiveAuth(client, password);
  }

  return new Promise((resolve, reject) => {
    client
      .on("ready", () => {
        client.shell({ term: "xterm-256color", cols: 120, rows: 30 }, (err, stream) => {
          if (err) {
            client.end();
            reject(new Error(`堡垒机 shell 失败: ${err.message}`));
            return;
          }

          let buf = "";
          stream.on("data", (data: Buffer) => {
            buf += data.toString("utf8");
          });

          const session: BastionMenuSession = {
            selectTarget: async (select) => {
              await waitForBuffer(
                () => buf,
                () => hasBastionMenuPrompt(buf),
                20_000,
                "等待堡垒机菜单",
              );
              stream.write(`s${BASTION_SHELL_EOL}`);
              await waitForBuffer(
                () => buf,
                () => buf.includes("输入搜索关键字"),
                10_000,
                "等待搜索提示",
              );
              stream.write(`${select.keyword.trim()}${BASTION_SHELL_EOL}`);
              await sleep(1500);
              stream.write(`${select.pickIndex ?? 1}${BASTION_SHELL_EOL}`);
              await waitForBuffer(
                () => buf,
                () => hasRemoteShellPrompt(buf),
                30_000,
                "等待目标机 shell",
              );
            },
            exec: (command, execOpts) => execViaShellStream(stream, () => buf, command, execOpts),
            probeSftp: () =>
              Promise.reject(new Error("堡垒机菜单会话不支持 SFTP，请使用 connectSshThroughBastion")),
            close: () => {
              try {
                stream.end();
                client.end();
              } catch {
                /* ignore */
              }
            },
          };
          resolve(session);
        });
      })
      .on("error", (err) => {
        reject(normalizeSshError(err, config, "连接"));
      })
      .connect(config);
  });
}

/** 经堡垒机菜单搜索并连接目标，再执行单条命令 */
export async function execSshCommandViaBastionMenu(
  bastion: SshConnectOptions,
  select: BastionMenuSelectOptions,
  command: string,
  execOpts?: SshExecOptions,
): Promise<SshExecResult> {
  const session = await connectBastionMenuSession(bastion);
  try {
    await session.selectTarget(select);
    return await session.exec(command, execOpts);
  } finally {
    session.close();
  }
}

/** 单次连接执行远程命令，执行完毕自动关闭连接 */
export async function execSshCommand(
  connectOptions: SshConnectOptions,
  command: string,
  execOpts?: SshExecOptions,
): Promise<SshExecResult> {
  const session = await connectSsh(connectOptions);
  try {
    return await session.exec(command, execOpts);
  } finally {
    session.close();
  }
}

/** 在自动关闭的连接上执行回调（适合连续多条命令） */
export async function withSshSession<T>(
  connectOptions: SshConnectOptions,
  fn: (session: SshSession) => Promise<T>,
): Promise<T> {
  const session = await connectSsh(connectOptions);
  try {
    return await fn(session);
  } finally {
    session.close();
  }
}

/** 探测 SSH 连通性：优先 exec `echo ok`，不支持 exec 时回退 SFTP */
export async function testSshConnection(options: SshConnectOptions): Promise<boolean> {
  const session = await connectSsh(options);
  try {
    try {
      const result = await session.exec("echo ok", { timeoutMs: 10_000 });
      return result.exitCode === 0 && result.stdout.trim() === "ok";
    } catch (e) {
      if (!isExecNotSupportedError(e)) throw e;
      await session.probeSftp();
      return true;
    }
  } finally {
    session.close();
  }
}

/** 快速验证：连通则打印成功并返回 true，否则抛错 */
export async function quickVerifySsh(options: SshConnectOptions): Promise<boolean> {
  const port = options.port ?? DEFAULT_PORT;
  const target = options.bastionTarget;

  try {
    return await runQuickVerifySession(options, port, target);
  } catch (e) {
    if (!isAuthFailedError(e) || !target) throw e;

    // 穿透失败时，区分「堡垒机密码错」与「仅目标机无权限」
    try {
      await connectSsh({ ...options, bastionTarget: undefined });
      const pierceUser = buildBastionPierceUsername(options.username, target);
      throw new Error(
        `堡垒机 ${options.host}:${port} 账号可用，但穿透 ${target.user}@${target.host} 认证失败。` +
          ` 请确认您有该资产运维权限；穿透用户名为 ${pierceUser}`,
      );
    } catch (inner) {
      if (isAuthFailedError(inner)) throw e;
      throw inner;
    }
  }
}

async function runQuickVerifySession(
  options: SshConnectOptions,
  port: number,
  target: SshBastionTarget | undefined,
): Promise<boolean> {
  const session = await connectSsh(options);
  try {
    try {
      const result = await session.exec("echo ok", { timeoutMs: 15_000 });
      if (result.exitCode !== 0 || result.stdout.trim() !== "ok") {
        throw new Error("SSH 验证失败（echo ok 未成功）");
      }
      if (target) {
        console.log(
          `SSH 堡垒机 ${options.host}:${port} → ${target.user}@${target.host} 连接成功（exec）`,
        );
      } else {
        console.log(`SSH ${options.host}:${port} 连接成功（exec）`);
      }
      return true;
    } catch (e) {
      if (!isExecNotSupportedError(e)) throw e;
      if (target) {
        throw new Error(
          `SSH 堡垒机穿透 ${target.user}@${target.host} 后仍无法 exec，请检查目标账号权限`,
        );
      }
      await session.probeSftp();
      console.log(
        `SSH ${options.host}:${port} 连接成功（SFTP；要执行命令请配置 SSH_TARGET_HOST / SSH_TARGET_USER）`,
      );
      return true;
    }
  } finally {
    session.close();
  }
}

export type SshEnvOverrides = {
  targetHost?: string;
  targetUser?: string;
  /** 设为 false 时不穿透，仅连堡垒机 */
  usePierce?: boolean;
};

function readBastionTargetFromEnv(overrides?: SshEnvOverrides): SshBastionTarget | undefined {
  if (overrides?.usePierce === false) {
    return undefined;
  }
  const pierceRaw = process.env.SSH_USE_PIERCE?.trim().toLowerCase();
  if (overrides?.usePierce !== true && (pierceRaw === "0" || pierceRaw === "false" || pierceRaw === "no")) {
    return undefined;
  }
  const host = overrides?.targetHost?.trim() ?? process.env.SSH_TARGET_HOST?.trim();
  const user = overrides?.targetUser?.trim() ?? process.env.SSH_TARGET_USER?.trim();
  if (!host && !user) return undefined;
  if (!host || !user) {
    throw new Error("SSH_TARGET_HOST 与 SSH_TARGET_USER 需同时配置");
  }
  return { host, user };
}

export function readSshExecTimeoutFromEnv(): number | undefined {
  const raw = process.env.SSH_COMMAND_TIMEOUT_MS?.trim();
  if (!raw) return undefined;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`SSH_COMMAND_TIMEOUT_MS 无效: ${raw}`);
  }
  return ms;
}

/** 连接远程并执行命令，等待 stdout/stderr 返回 */
export async function runSshRemoteCommand(
  connectOptions: SshConnectOptions,
  command: string,
  execOpts?: SshExecOptions,
): Promise<SshExecResult> {
  const cmd = command.trim();
  if (!cmd) {
    throw new Error("runSshRemoteCommand: command 不能为空");
  }
  return execSshCommand(connectOptions, cmd, execOpts);
}

function parseCliCommand(): string | undefined {
  const fromEnv = process.env.SSH_COMMAND?.trim();
  if (fromEnv) return fromEnv;

  const args = process.argv.slice(2);
  const cmdFlagIdx = args.indexOf("--cmd");
  if (cmdFlagIdx >= 0) {
    const rest = args.slice(cmdFlagIdx + 1).filter((a) => a !== "--");
    if (rest.length > 0) return rest.join(" ");
    return undefined;
  }

  const positional = args.filter((a) => a !== "--");
  if (positional.length > 0) return positional.join(" ");
  return undefined;
}

function printExecResult(result: SshExecResult): void {
  if (result.stdout) {
    process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
  }
  console.log(`exitCode: ${result.exitCode ?? "null"}`);
}

function sshOptionsFromEnv(): SshConnectOptions {
  return buildSshConnectOptionsFromEnv();
}

/** 从环境变量组装 SSH 连接参数；堡垒机凭据读 `.env`，目标机可由 overrides 覆盖 */
export function buildSshConnectOptionsFromEnv(overrides?: SshEnvOverrides): SshConnectOptions {
  const host = process.env.SSH_HOST?.trim();
  const portRaw = process.env.SSH_PORT?.trim();
  const username = process.env.SSH_USER?.trim();
  if (!host || !portRaw || !username) {
    throw new Error(
      "请设置环境变量 SSH_HOST、SSH_PORT、SSH_USER（以及 SSH_PASSWORD 或 SSH_PRIVATE_KEY）",
    );
  }
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`SSH_PORT 无效: ${portRaw}`);
  }
  const password = process.env.SSH_PASSWORD?.trim();
  const privateKey = process.env.SSH_PRIVATE_KEY?.trim();
  if (!password && !privateKey) {
    throw new Error("请设置 SSH_PASSWORD 或 SSH_PRIVATE_KEY 之一");
  }
  const bastionTarget = readBastionTargetFromEnv(overrides);
  return {
    host,
    port,
    username,
    password,
    privateKey,
    passphrase: process.env.SSH_PASSPHRASE?.trim(),
    bastionTarget,
  };
}

/** CLI 入口：`npm run ssh:verify` 或 `tsx src/services/tools/sshClient.ts [--cmd] "命令"` */
async function main(): Promise<void> {
  const options = sshOptionsFromEnv();
  const command = parseCliCommand();

  if (command) {
    const timeoutMs = readSshExecTimeoutFromEnv() ?? DEFAULT_EXEC_TIMEOUT_MS;
    const result = await runSshRemoteCommand(options, command, { timeoutMs });
    printExecResult(result);
    if (result.exitCode != null && result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
    return;
  }

  await quickVerifySsh(options);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
