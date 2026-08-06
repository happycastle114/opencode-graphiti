import { describe, expect, test } from "bun:test";
import {
  saveFinishedTurnMemories,
  saveSessionDigestMemory,
  type MemoryGroups,
} from "../src/services/memory-capture.js";
import { buildSessionDigest } from "../src/services/memory-enhancement.js";
import { asMessage, getText } from "../src/services/message-parts.js";
import { buildReplayTimeline } from "../src/services/replay.js";
import type { EpisodeSource, MemoryType } from "../src/types/index.js";

type StoredMemory = {
  readonly content: string;
  readonly groupId: string;
  readonly metadata?: {
    readonly type?: MemoryType;
    readonly name?: string;
    readonly source?: EpisodeSource;
    readonly [key: string]: unknown;
  };
};

type StoreOptions = {
  readonly initialMemories?: readonly StoredMemory[];
  readonly searchError?: string;
};

const GROUPS: MemoryGroups = {
  user: "user-group",
  project: "project-group",
};

function createMemoryStore(options: StoreOptions = {}) {
  const stored: StoredMemory[] = [];
  const candidates = [...(options.initialMemories ?? [])];

  return {
    stored,
    store: {
      async searchMemories(_query: string, groupId: string) {
        if (options.searchError) {
          return { success: false as const, error: options.searchError };
        }
        return {
          success: true as const,
          results: [...candidates, ...stored]
            .filter((memory) => memory.groupId === groupId)
            .map((memory, index) => ({
              id: `memory-${index}`,
              memory: memory.content,
              similarity: null,
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

describe("automatic memory persistence", () => {
  test("removes injected and system-reminder content from a finished turn", async () => {
    // Given
    const { store, stored } = createMemoryStore();
    const userMessage = asMessage({
      parts: [
        {
          type: "text",
          synthetic: true,
          text: "[GRAPHITI MEMORY - Temporal Knowledge Graph]\nProject Knowledge (entities & facts):\n- injected fact",
        },
        {
          type: "text",
          text: "Please update the release workflow for this repository.\n<system-reminder>internal instruction</system-reminder>\nKeep the production verification steps documented for maintainers.",
        },
      ],
    });

    // When
    const result = await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-1",
      userText: getText(userMessage?.parts),
      assistantText: "I updated the release workflow. <system-reminder>hidden assistant instruction</system-reminder> The verification steps remain documented for maintainers.",
      saveProfile: false,
    });

    // Then
    expect(result.turn.kind).toBe("saved");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toContain("Please update the release workflow");
    expect(stored[0]?.content).not.toContain("GRAPHITI MEMORY");
    expect(stored[0]?.content).not.toContain("system-reminder");
    expect(stored[0]?.content).not.toContain("internal instruction");
  });

  test("keeps a finished turn containing a persistent English preference in the project group", async () => {
    // Given
    const { store, stored } = createMemoryStore();

    // When
    await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-english",
      userText: "From now on, please keep my responses concise across projects.",
      assistantText: "I will keep future responses concise while preserving the technical details needed to complete each request.",
      saveProfile: false,
    });

    // Then
    expect(stored[0]?.groupId).toBe(GROUPS.project);
  });

  test("keeps a finished turn containing a persistent Korean preference in the project group", async () => {
    // Given
    const { store, stored } = createMemoryStore();

    // When
    await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-korean",
      userText: "앞으로 항상 답변을 간결하게 해주세요.",
      assistantText: "앞으로 필요한 기술적 세부사항은 유지하면서 답변을 간결하게 작성하겠습니다.",
      saveProfile: false,
    });

    // Then
    expect(stored[0]?.groupId).toBe(GROUPS.project);
  });

  test("stores a mixed preference and project-detail turn in project scope with only its profile atom in user scope", async () => {
    // Given
    const { store, stored } = createMemoryStore();

    // When
    await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-mixed-scope",
      userText: "From now on, please keep my responses concise across projects. This repository pins Graphiti version 1.94.0 and requires Bun verification before release.",
      assistantText: "I will keep responses concise and preserve the repository's pinned Graphiti version and Bun release checks.",
      saveProfile: true,
    });

    // Then
    expect(stored).toEqual([
      {
        content: "From now on, please keep my responses concise across projects.",
        groupId: GROUPS.user,
        metadata: { type: "style", name: "profile-turn-mixed-scope", source: "message" },
      },
      expect.objectContaining({
        groupId: GROUPS.project,
        content: expect.stringContaining("Graphiti version 1.94.0"),
      }),
    ]);
  });

  test("does not save an English same-sentence preference mixed with repository facts to user scope", async () => {
    // Given
    const { store, stored } = createMemoryStore();

    // When
    await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-english-mixed-sentence",
      userText: "From now on, please keep my responses concise and remember the repository pins Graphiti version 1.94.0.",
      assistantText: "I will preserve the repository's Graphiti version while keeping the response concise.",
      saveProfile: true,
    });

    // Then
    expect(stored).toHaveLength(1);
    expect(stored[0]?.groupId).toBe(GROUPS.project);
  });

  test("does not save a Korean same-sentence preference mixed with service facts to user scope", async () => {
    // Given
    const { store, stored } = createMemoryStore();

    // When
    await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-korean-mixed-sentence",
      userText: "앞으로 항상 답변을 간결하게 해주세요 그리고 Graphiti 1.94.0 버전을 고정해 주세요.",
      assistantText: "간결한 답변을 유지하면서 서비스의 Graphiti 버전 고정을 보존하겠습니다.",
      saveProfile: true,
    });

    // Then
    expect(stored).toHaveLength(1);
    expect(stored[0]?.groupId).toBe(GROUPS.project);
  });

  test("keeps a repository request from a finished turn in the project group", async () => {
    // Given
    const { store, stored } = createMemoryStore();

    // When
    await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-repository",
      userText: "From now on, use Bun for dependency installation and test execution in this repository.",
      assistantText: "I will use Bun for this repository's dependency installation, focused tests, and type checking workflows.",
      saveProfile: false,
    });

    // Then
    expect(stored[0]?.groupId).toBe(GROUPS.project);
  });

  test("keeps a service request from a finished turn in the project group", async () => {
    // Given
    const { store, stored } = createMemoryStore();

    // When
    await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-service",
      userText: "Always use strict TypeScript and Bun tests for this service before release.",
      assistantText: "I will keep the service-specific strict TypeScript and Bun test requirements in the release workflow.",
      saveProfile: false,
    });

    // Then
    expect(stored[0]?.groupId).toBe(GROUPS.project);
  });

  test("skips a repeated finished turn when the remote candidate has null similarity", async () => {
    // Given
    const { store, stored } = createMemoryStore();
    const turn = {
      turnId: "turn-repeat",
      userText: "Use Bun to run the repository release verification before publishing the package.",
      assistantText: "The Bun tests and TypeScript verification completed successfully before the package publication step.",
      saveProfile: false,
    } as const;
    await saveFinishedTurnMemories(store, GROUPS, turn);

    // When
    const repeated = await saveFinishedTurnMemories(store, GROUPS, turn);

    // Then
    expect(repeated.turn.kind).toBe("duplicate");
    expect(stored).toHaveLength(1);
  });

  test("sanitizes and keeps a persistent preference session digest in the project group", async () => {
    // Given
    const { store, stored } = createMemoryStore();
    const timeline = buildReplayTimeline("session-42", [
      {
        info: { id: "user-1", role: "user", time: { created: 100 } },
        parts: [
          { type: "text", text: "Injected Graphiti context", synthetic: true },
          {
            type: "text",
            text: "From now on, please keep my responses concise across projects. <system-reminder>internal digest instruction</system-reminder>",
          },
        ],
      },
      {
        info: { id: "assistant-1", role: "assistant", time: { created: 200 } },
        parts: [{ type: "text", text: "I will keep future responses concise while preserving necessary technical detail." }],
      },
    ]);
    const digest = buildSessionDigest(timeline);

    // When
    const saved = await saveSessionDigestMemory(store, GROUPS, {
      sessionId: "session-42",
      digest,
    });

    // Then
    expect(saved).toBe(true);
    expect(stored[0]?.groupId).toBe(GROUPS.project);
    expect(stored[0]?.content).not.toContain("Session Digest");
    expect(stored[0]?.content).not.toContain("system-reminder");
    expect(stored[0]?.content).not.toContain("internal digest instruction");
    expect(stored[0]?.content).not.toContain("Injected Graphiti context");
  });

  test("skips a repeated session digest when the remote candidate has null similarity", async () => {
    // Given
    const { store, stored } = createMemoryStore();
    const input = {
      sessionId: "session-repeat",
      digest: "[Session Digest]\nSession: session-repeat\nCaptured exchanges: 1\nUser: Use Bun for repository release verification and preserve the current production route owner.",
    } as const;
    await saveSessionDigestMemory(store, GROUPS, input);

    // When
    const repeated = await saveSessionDigestMemory(store, GROUPS, input);

    // Then
    expect(repeated).toBe(false);
    expect(stored).toHaveLength(1);
  });

  test("continues a legitimate automatic write when duplicate lookup fails", async () => {
    // Given
    const { store, stored } = createMemoryStore({ searchError: "search unavailable" });
    const failures: string[] = [];

    // When
    const result = await saveFinishedTurnMemories(store, GROUPS, {
      turnId: "turn-search-failure",
      userText: "Use Bun for all verification commands in this repository before creating a release artifact.",
      assistantText: "I will continue with the Bun verification workflow and preserve the existing release requirements.",
      saveProfile: false,
      onDedupLookupFailure: (failure) => failures.push(failure.error ?? "unknown"),
    });

    // Then
    expect(result.turn.kind).toBe("saved");
    expect(stored).toHaveLength(1);
    expect(failures).toEqual(["search unavailable"]);
  });
});
