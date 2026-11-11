import { describe, expect, test } from "bun:test";
import { persistDistinctMemory } from "../src/services/memory-storage.js";

describe("distinct memory persistence", () => {
  test("skips an existing raw episode when semantic search returns no candidates", async () => {
    const content = "Conversation turn:\n\nUser: Keep the Graphiti deployment verified.\n\nAssistant: I will verify the deployment with a live request.";
    const writes: string[] = [];
    const store = {
      async searchMemories() {
        return { success: true as const, results: [] };
      },
      async listMemories() {
        return {
          success: true as const,
          memories: [{ id: "episode-1", summary: content }],
        };
      },
      async addMemory(memory: string) {
        writes.push(memory);
        return { success: true as const };
      },
    };

    const result = await persistDistinctMemory(store, {
      content,
      groupId: "project-group",
      metadata: { type: "conversation", source: "message" },
    });

    expect(result).toEqual({
      kind: "duplicate",
      existingId: "episode-1",
      reason: "normalized-exact",
    });
    expect(writes).toEqual([]);
  });
});
