import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectGroupForRemote } from "../src/services/tags.js";

const vectors = JSON.parse(readFileSync(join(import.meta.dir, "slug-vectors.json"), "utf-8")) as [string, string][];

describe("scoped project groups", () => {
  test("match the shared slug vectors used by memctl and memory-hub", () => {
    for (const [remote, want] of vectors) {
      expect(projectGroupForRemote(remote)).toBe(want);
    }
  });
});
