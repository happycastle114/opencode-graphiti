import { describe, expect, test } from "bun:test";
import {
  saveFinishedTurnMemories,
  type MemoryGroups,
} from "../src/services/memory-capture.js";
import { formatContextForPrompt } from "../src/services/context.js";
import type { MemoryResult } from "../src/types/index.js";

type StoredMemory = {
  readonly content: string;
  readonly groupId: string;
  readonly metadata?: {
    readonly type?: string;
    readonly name?: string;
    readonly source?: string;
    readonly [key: string]: unknown;
  };
};

/**
 * In-memory double that enforces group-scoped isolation on search.
 * Each search filters by groupId — a query under project B can never
 * see memories written under project A.
 */
function createIsolationMemoryStore(options: { readonly initialMemories?: readonly StoredMemory[] } = {}) {
  const stored: StoredMemory[] = [...(options.initialMemories ?? [])];

  return {
    stored,
    store: {
      async listMemories(groupId: string) {
        return {
          success: true as const,
          memories: stored
            .filter((memory) => memory.groupId === groupId)
            .map((memory, index) => ({
              id: `memory-${index}`,
              summary: memory.content,
            })),
        };
      },
      async searchMemories(_query: string, groupId: string) {
        return {
          success: true as const,
          results: stored
            .filter((memory) => memory.groupId === groupId)
            .map((memory, index) => ({
              id: `memory-${index}`,
              memory: memory.content,
              similarity: null,
              groupId: memory.groupId,
            })),
        };
      },
      async addMemory(
        content: string,
        groupId: string,
        metadata?: StoredMemory["metadata"],
      ) {
        stored.push({ content, groupId, metadata });
        return { success: true as const, message: "saved" };
      },
    },
  };
}

const PROJECT_A_GROUPS: MemoryGroups = {
  user: "user-group-a",
  project: "project-alpha",
};

const PROJECT_B_GROUPS: MemoryGroups = {
  user: "user-group-b",
  project: "project-beta",
};

const DISTINCTIVE_FACT =
  "Project Alpha uses a custom Zod schema registry called AlphaRegistry for all boundary validation.";

describe("cross-project read isolation", () => {
  test("project B retrieval returns zero results for a fact written under project A", async () => {
    // Given — write a distinctive fact into project A
    const { store, stored } = createIsolationMemoryStore();
    await saveFinishedTurnMemories(store, PROJECT_A_GROUPS, {
      turnId: "turn-alpha-1",
      userText: `Remember that ${DISTINCTIVE_FACT}`,
      assistantText: `I have noted that ${DISTINCTIVE_FACT} This is a sufficiently long assistant response to pass the storage threshold for this test case.`,
      saveProfile: false,
    });

    // Confirm the fact landed in project A
    expect(stored.some((m) => m.groupId === PROJECT_A_GROUPS.project && m.content.includes("AlphaRegistry"))).toBe(true);

    // When — search under project B's group
    const result = await store.searchMemories("AlphaRegistry", PROJECT_B_GROUPS.project);

    // Then — zero results: B cannot see A's memories
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  test("user group retrieval returns zero results for facts written under either project", async () => {
    // Given — facts exist in both project groups
    const { store, stored } = createIsolationMemoryStore();
    await saveFinishedTurnMemories(store, PROJECT_A_GROUPS, {
      turnId: "turn-alpha-2",
      userText: `Remember that ${DISTINCTIVE_FACT}`,
      assistantText: `I have noted that ${DISTINCTIVE_FACT} This is a sufficiently long assistant response to pass the storage threshold for this test case.`,
      saveProfile: false,
    });
    await saveFinishedTurnMemories(store, PROJECT_B_GROUPS, {
      turnId: "turn-beta-2",
      userText: "Remember that Project Beta uses a different validation library called BetaGuard for all boundary validation across the service.",
      assistantText: "I have noted that Project Beta uses BetaGuard. This is a sufficiently long assistant response to pass the storage threshold for this test case.",
      saveProfile: false,
    });

    // Confirm facts landed in respective project groups, not user groups
    expect(stored.filter((m) => m.groupId === PROJECT_A_GROUPS.user)).toHaveLength(0);
    expect(stored.filter((m) => m.groupId === PROJECT_B_GROUPS.user)).toHaveLength(0);
    expect(stored.filter((m) => m.groupId === PROJECT_A_GROUPS.project).length).toBeGreaterThan(0);
    expect(stored.filter((m) => m.groupId === PROJECT_B_GROUPS.project).length).toBeGreaterThan(0);

    // When — search under each project's user group
    const userA = await store.searchMemories("validation", PROJECT_A_GROUPS.user);
    const userB = await store.searchMemories("validation", PROJECT_B_GROUPS.user);

    // Then — user groups contain nothing from either project
    expect(userA.results).toHaveLength(0);
    expect(userB.results).toHaveLength(0);
  });

  test("a deliberately mis-scoped query using A's group makes A's fact reachable, proving the test is not vacuous", async () => {
    // Given — fact written under project A
    const { store, stored } = createIsolationMemoryStore();
    await saveFinishedTurnMemories(store, PROJECT_A_GROUPS, {
      turnId: "turn-alpha-3",
      userText: `Remember that ${DISTINCTIVE_FACT}`,
      assistantText: `I have noted that ${DISTINCTIVE_FACT} This is a sufficiently long assistant response to pass the storage threshold for this test case.`,
      saveProfile: false,
    });

    // Sanity: fact exists in A
    expect(stored.some((m) => m.groupId === PROJECT_A_GROUPS.project)).toBe(true);

    // When — query "as B" but deliberately pass A's project group (mis-scoped)
    const misScopedResult = await store.searchMemories("AlphaRegistry", PROJECT_A_GROUPS.project);

    // Then — the fact IS reachable when A's group is used, proving B's isolation is real
    expect(misScopedResult.success).toBe(true);
    expect(misScopedResult.results.length).toBeGreaterThan(0);
    expect(
      misScopedResult.results.some((r) => r.memory?.includes("AlphaRegistry")),
    ).toBe(true);

    // And each result carries the originating groupId
    for (const result of misScopedResult.results) {
      expect(result.groupId).toBe(PROJECT_A_GROUPS.project);
    }
  });

  test("MemoryResult carries the originating groupId", async () => {
    // Given
    const { store } = createIsolationMemoryStore();
    await saveFinishedTurnMemories(store, PROJECT_A_GROUPS, {
      turnId: "turn-alpha-4",
      userText: `Remember that ${DISTINCTIVE_FACT}`,
      assistantText: `I have noted that ${DISTINCTIVE_FACT} This is a sufficiently long assistant response to pass the storage threshold for this test case.`,
      saveProfile: false,
    });

    // When
    const result = await store.searchMemories("AlphaRegistry", PROJECT_A_GROUPS.project);

    // Then — every result carries groupId
    expect(result.success).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    for (const memory of result.results) {
      expect(memory.groupId).toBeDefined();
      expect(memory.groupId).toBe(PROJECT_A_GROUPS.project);
    }
  });

  test("context.ts renders shared-group entries with origin group labels", () => {
    // Given — memories from two different shared groups merged into project memories
    const sharedGroupA = "shared-team-alpha";
    const sharedGroupB = "shared-team-beta";
    const projectMemories: { results: MemoryResult[] } = {
      results: [
        {
          id: "mem-a",
          memory: "Team Alpha deploys on Fridays only",
          similarity: null,
          groupId: sharedGroupA,
        },
        {
          id: "mem-b",
          memory: "Team Beta requires code review before merge",
          similarity: null,
          groupId: sharedGroupB,
        },
      ],
    };

    // When
    const context = formatContextForPrompt(null, { results: [] }, projectMemories);

    // Then — both entries are present and distinguishable by origin group
    expect(context).toContain("Team Alpha deploys on Fridays only");
    expect(context).toContain("Team Beta requires code review before merge");
    expect(context).toContain(sharedGroupA);
    expect(context).toContain(sharedGroupB);
  });
});
