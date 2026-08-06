import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  AtomicJsonStoreError,
  createAtomicJsonStore,
} from "../src/services/atomic-json-store.js";

type StoredValue = {
  readonly sequence: number;
};

describe("atomic JSON store", () => {
  test("persists the final value when writes are interleaved", async () => {
    // Given
    const root = mkdtempSync(join(tmpdir(), "opencode-graphiti-atomic-store-"));
    const filePath = join(root, "values", "state.json");
    const store = createAtomicJsonStore<StoredValue>(filePath);

    try {
      // When
      const writes = Array.from({ length: 50 }, (_, sequence) =>
        store.write({ sequence }),
      );
      await Promise.all(writes);

      // Then
      expect(readFileSync(filePath, "utf-8")).toBe(JSON.stringify({ sequence: 49 }));
      expect(store.read()).toEqual({ sequence: 49 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("surfaces a typed error without temporary residue when the parent is a file", async () => {
    // Given
    const root = mkdtempSync(join(tmpdir(), "opencode-graphiti-atomic-store-"));
    const parentPath = join(root, "blocking-parent");
    writeFileSync(parentPath, "not a directory", { encoding: "utf-8", mode: 0o600 });
    const store = createAtomicJsonStore<StoredValue>(join(parentPath, "state.json"));

    try {
      // When / Then
      expect.assertions(2);
      try {
        await store.write({ sequence: 1 });
      } catch (error) {
        if (!(error instanceof AtomicJsonStoreError)) throw error;
        expect(error.operation).toBe("write");
      }
      expect(readdirSync(root).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("purge is a no-op when the file is absent", () => {
    // Given
    const root = mkdtempSync(join(tmpdir(), "opencode-graphiti-atomic-store-"));
    const store = createAtomicJsonStore<StoredValue>(join(root, "missing.json"));

    try {
      // When / Then
      expect(() => store.purge()).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("creates the directory and file with restrictive modes", async () => {
    // Given
    const root = mkdtempSync(join(tmpdir(), "opencode-graphiti-atomic-store-"));
    const filePath = join(root, "private", "state.json");
    const store = createAtomicJsonStore<StoredValue>(filePath);

    try {
      // When
      await store.write({ sequence: 1 });

      // Then
      expect(statSync(dirname(filePath)).mode & 0o777).toBe(0o700);
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
