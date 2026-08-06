import { describe, expect, test } from "bun:test";
import { saveCompactionSummary } from "../src/services/compaction.js";

describe("compaction summary storage", () => {
  test("sanitizes, filters, and deduplicates an injected compaction summary before writing", async () => {
    // Given
    const writes: string[] = [];
    const store = {
      async searchMemories() {
        return {
          success: true as const,
          results: writes.map((memory, index) => ({
            id: `memory-${index}`,
            memory,
            similarity: null,
          })),
        };
      },
      async addMemory(content: string) {
        writes.push(content);
        return { success: true as const };
      },
    };
    const summary = `[GRAPHITI MEMORY - Temporal Knowledge Graph]
Project Knowledge (entities & facts):
- injected project fact
  that must not be persisted

The real summary records the verified release workflow, remaining migration tasks, and the operator-approved rollback checks for production deployment.`;

    // When
    const first = await saveCompactionSummary(store, "project-group", "session-42", summary);
    const second = await saveCompactionSummary(store, "project-group", "session-42", summary);

    // Then
    expect(first.kind).toBe("saved");
    expect(second.kind).toBe("duplicate");
    expect(writes).toEqual([
      "The real summary records the verified release workflow, remaining migration tasks, and the operator-approved rollback checks for production deployment.",
    ]);
  });
});
