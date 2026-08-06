import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type AtomicJsonStoreOperation = "read" | "write" | "purge";

export class AtomicJsonStoreError extends Error {
  override readonly name = "AtomicJsonStoreError";

  constructor(
    readonly operation: AtomicJsonStoreOperation,
    readonly filePath: string,
    options?: ErrorOptions,
  ) {
    super(`Failed to ${operation} atomic JSON store at ${filePath}`, options);
  }
}

export type AtomicJsonStore<T> = {
  readonly read: () => T | null;
  readonly write: (value: T) => Promise<void>;
  readonly purge: () => void;
};

export function createAtomicJsonStore<T>(filePath: string): AtomicJsonStore<T> {
  const directory = dirname(filePath);
  const temporary = `${filePath}.${process.pid}.tmp`;
  let writeChain = Promise.resolve();

  return {
    read(): T | null {
      try {
        const value: T = JSON.parse(readFileSync(filePath, "utf-8"));
        return value;
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return null;
        }
        throw new AtomicJsonStoreError("read", filePath, { cause });
      }
    },
    write(value: T): Promise<void> {
      const write = writeChain.catch(() => undefined).then(() => {
        try {
          mkdirSync(directory, { recursive: true, mode: 0o700 });
          writeFileSync(temporary, JSON.stringify(value), {
            encoding: "utf-8",
            mode: 0o600,
          });
          renameSync(temporary, filePath);
        } catch (cause) {
          try {
            rmSync(temporary, { force: true });
          } catch (cleanupCause) {
            throw new AtomicJsonStoreError("write", filePath, {
              cause: new AggregateError([cause, cleanupCause]),
            });
          }
          throw new AtomicJsonStoreError("write", filePath, { cause });
        }
      });
      writeChain = write;
      return write;
    },
    purge(): void {
      try {
        rmSync(filePath, { force: true });
      } catch (cause) {
        throw new AtomicJsonStoreError("purge", filePath, { cause });
      }
    },
  };
}
