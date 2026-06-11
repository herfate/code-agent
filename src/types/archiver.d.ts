/** archiver v8 无 bundled types，与 @types/archiver（v6 API）不兼容 */
declare module "archiver" {
  import type { Writable } from "node:stream";

  export class ZipArchive extends Writable {
    constructor(options?: { zlib?: { level?: number } });
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    directory(dirpath: string, destpath: false | string): this;
    file(filepath: string, options?: { name?: string }): this;
    finalize(): void;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "warning", listener: (err: Error) => void): this;
  }
}
