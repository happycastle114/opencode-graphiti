import { describe, expect, test } from "bun:test";
import { formatContextForPrompt, prioritizeMemories } from "../src/services/context.js";
import {
  buildSessionDigest,
  extractExplicitProfileMemory,
} from "../src/services/memory-enhancement.js";

describe("explicit profile memory extraction", () => {
  test("captures an explicit response-style preference after redacting private content", () => {
    expect(extractExplicitProfileMemory("From now on, please keep my responses concise <private>api-key</private>")).toEqual({
      type: "style",
      content: "From now on, please keep my responses concise [REDACTED]",
    });
  });

  test("captures direct language preferences without requiring a durability keyword", () => {
    expect(extractExplicitProfileMemory("한국어로 답변해줘.")).toEqual({
      type: "style",
      content: "한국어로 답변해줘.",
    });
    expect(extractExplicitProfileMemory("Please respond in Korean.")).toEqual({
      type: "style",
      content: "Please respond in Korean.",
    });
  });

  test("does not infer a profile from ordinary or fully private conversation", () => {
    expect(extractExplicitProfileMemory("The build completed successfully.")).toBeNull();
    expect(extractExplicitProfileMemory("I want to know why this build failed.")).toBeNull();
    expect(extractExplicitProfileMemory("Please use Bun for this release.")).toBeNull();
    expect(extractExplicitProfileMemory("Please use concise answers for this response.")).toBeNull();
    expect(extractExplicitProfileMemory("Please use Bun always for this release.")).toBeNull();
    expect(extractExplicitProfileMemory("Please use concise answers always for this response.")).toBeNull();
    expect(extractExplicitProfileMemory("For this build, I prefer concise answers from now on.")).toBeNull();
    expect(extractExplicitProfileMemory("For this build, from now on, please keep my responses concise.")).toBeNull();
    expect(extractExplicitProfileMemory("현재 빌드에서는 앞으로 응답을 간결하게 해주세요.")).toBeNull();
    expect(extractExplicitProfileMemory("For my build, from now on, please keep my responses concise.")).toBeNull();
    expect(extractExplicitProfileMemory("<private>I prefer verbose replies</private>")).toBeNull();
  });

  test("rejects same-sentence compound preferences without relying on project vocabulary", () => {
    // Given
    const candidates = [
      "From now on, please keep my responses concise and remember production uses PostgreSQL.",
      "앞으로 답변을 간결하게 해주세요 그리고 운영 데이터베이스는 PostgreSQL을 사용합니다.",
      "From now on, please keep my responses concise and record violet-otter.example for the lantern.",
    ];

    // When
    const extracted = candidates.map(extractExplicitProfileMemory);

    // Then
    expect(extracted).toEqual([null, null, null]);
  });
});

describe("session digest", () => {
  test("creates a bounded chronological digest from user and assistant events", () => {
    const digest = buildSessionDigest({
      sessionId: "session-42",
      events: [
        { id: "user-1", role: "user", at: "2026-07-24T00:00:00.000Z", content: "Use Bun for the release." },
        { id: "assistant-1", role: "assistant", at: "2026-07-24T00:01:00.000Z", content: "I will run the Bun release gate." },
      ],
    });

    expect(digest).toContain("[Session Digest]");
    expect(digest).toContain("User: Use Bun for the release.");
    expect(digest).toContain("Assistant: I will run the Bun release gate.");
  });

  test("does not produce a digest when no user or assistant content is available", () => {
    expect(buildSessionDigest({
      sessionId: "session-42",
      events: [{ id: "system-1", role: "system", at: "2026-07-24T00:00:00.000Z", content: "System message" }],
    })).toBeNull();
  });
});

describe("memory injection priority", () => {
  test("sorts by similarity, temporal recency, then stable id", () => {
    const memories = prioritizeMemories([
      { id: "older", memory: "older", similarity: null, type: "fact", validAt: "2026-07-20T00:00:00.000Z" },
      { id: "similar", memory: "similar", similarity: 0.9, type: "episode", validAt: "2026-07-01T00:00:00.000Z" },
      { id: "newer", memory: "newer", similarity: null, type: "fact", validAt: "2026-07-23T00:00:00.000Z" },
    ]);

    expect(memories.map((memory) => memory.id)).toEqual(["similar", "newer", "older"]);
  });

  test("formats profile before user priorities and project knowledge", () => {
    const context = formatContextForPrompt(
      { profile: { static: ["Prefers concise responses"], dynamic: [] } },
      { results: [{ id: "style", memory: "Use short technical explanations", similarity: 0.8, type: "fact" }] },
      { results: [{ id: "project", memory: "Run Bun tests before release", similarity: 0.7, type: "fact" }] },
    );

    expect(context.indexOf("User Preferences")).toBeLessThan(context.indexOf("User Memory Priorities"));
    expect(context.indexOf("User Memory Priorities")).toBeLessThan(context.indexOf("Project Knowledge"));
  });

  test("orders profile facts deterministically before injection", () => {
    const context = formatContextForPrompt(
      { profile: { static: ["Zebra preference", "Alpha preference"], dynamic: ["Recent Z", "Recent A"] } },
      { results: [] },
      { results: [] },
    );

    expect(context.indexOf("Alpha preference")).toBeLessThan(context.indexOf("Zebra preference"));
    expect(context.indexOf("Recent A")).toBeLessThan(context.indexOf("Recent Z"));
  });

  test("indents multiline memory continuations while preserving single-line formatting", () => {
    // Given
    const context = formatContextForPrompt(
      null,
      { results: [] },
      {
        results: [
          { id: "single", memory: "Single memory", similarity: null, type: "fact" },
          { id: "multi", memory: "First line\nSecond line", similarity: null, type: "fact" },
        ],
      },
    );

    // When
    const memoryLines = context.split("\n").filter((line) => line.startsWith("- ") || line === "  Second line");

    // Then
    expect(memoryLines).toEqual([
      "- [fact] First line",
      "  Second line",
      "- [fact] Single memory",
    ]);
  });
});
