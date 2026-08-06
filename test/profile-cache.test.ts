import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfileCache } from "../src/services/profile-cache.js";

describe("profile cache", () => {
  test("persists and deduplicates profile statements by group", async () => {
    const directory = mkdtempSync(join(tmpdir(), "graphiti-profile-"));
    const cache = createProfileCache(join(directory, "profile.json"));

    try {
      await cache.save("user-group", "Prefers Korean responses.");
      await cache.save("user-group", "Prefers Korean responses.");
      await cache.save("project-group", "Uses the Graphiti REST API.");

      expect(cache.read("user-group")).toEqual(["Prefers Korean responses."]);
      expect(cache.read("project-group")).toEqual(["Uses the Graphiti REST API."]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
