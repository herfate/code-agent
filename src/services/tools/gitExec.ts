/** Windows 默认 MAX_PATH=260；深层目录仓库克隆/检出需开启 longpaths */
export function gitCliArgs(args: string[]): string[] {
  if (process.platform === "win32") {
    return ["-c", "core.longpaths=true", ...args];
  }
  return args;
}
