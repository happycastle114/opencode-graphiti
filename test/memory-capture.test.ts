import { describe, expect, test } from "bun:test";
import {
  createSessionDigestRefresher,
  createSessionDigestSaver,
  saveExplicitProfileMemory,
  saveSessionDigestMemory,
} from "../src/services/memory-capture.js";

function createWriter() {
  const calls: Array<{ content: string; groupId: string; metadata?: Record<string, unknown> }> = [];
  return {
    calls,
    writer: {
      searchMemories: async (_query: string, groupId: string) => ({
        success: true as const,
        results: calls
          .filter((call) => call.groupId === groupId)
          .map((call, index) => ({
            id: `memory-${index}`,
            memory: call.content,
            similarity: null,
          })),
      }),
      addMemory: async (content: string, groupId: string, metadata?: Record<string, unknown>) => {
        calls.push({ content, groupId, metadata });
        return { success: true as const, message: "saved" };
      },
    },
  };
}

describe("automatic memory capture", () => {
  test("writes an explicit style preference to the user group", async () => {
    const { calls, writer } = createWriter();

    const saved = await saveExplicitProfileMemory(writer, { user: "user-group", project: "project-group" }, "From now on, please keep my answers concise.", "turn-1");

    expect(saved).toBe(true);
    expect(calls).toEqual([{
      content: "From now on, please keep my answers concise.",
      groupId: "user-group",
      metadata: { type: "style", name: "profile-turn-1", source: "message" },
    }]);
  });

  test("does not write inferred preferences", async () => {
    const { calls, writer } = createWriter();

    expect(await saveExplicitProfileMemory(writer, { user: "user-group", project: "project-group" }, "The build completed.", "turn-1")).toBe(false);
    expect(await saveExplicitProfileMemory(writer, { user: "user-group", project: "project-group" }, "For this build, I prefer concise answers from now on.", "turn-2")).toBe(false);
    expect(await saveExplicitProfileMemory(writer, { user: "user-group", project: "project-group" }, "For this build, from now on, please keep my responses concise.", "turn-3")).toBe(false);
    expect(await saveExplicitProfileMemory(writer, { user: "user-group", project: "project-group" }, "현재 빌드에서는 앞으로 응답을 간결하게 해주세요.", "turn-4")).toBe(false);
    expect(calls).toEqual([]);
  });

  test("writes a session digest once to the project group", async () => {
    const { calls, writer } = createWriter();

    const saved = await saveSessionDigestMemory(writer, { user: "user-group", project: "project-group" }, {
      sessionId: "session-42",
      digest: "[Session Digest]\nUser: Use Bun for releases.",
    });

    expect(saved).toBe(true);
    expect(calls).toEqual([{
      content: "User: Use Bun for releases.",
      groupId: "project-group",
      metadata: { type: "conversation", name: "session-digest-session-42", source: "message" },
    }]);
  });

  test("coalesces concurrent unchanged idle digests into one remote write", async () => {
    const { calls, writer } = createWriter();
    const saver = createSessionDigestSaver(writer, { user: "user-group", project: "project-group" });
    const digest = "[Session Digest]\nUser: Use Bun for releases.";

    const results = await Promise.all([
      saver.save("session-42", digest),
      saver.save("session-42", digest),
    ]);

    expect(results).toEqual([true, false]);
    expect(calls).toHaveLength(1);
  });

  test("serializes changed digest snapshots so stale completion cannot re-enable a duplicate", async () => {
    const calls: string[] = [];
    const resolvers: Array<(result: { success: true }) => void> = [];
    let notifyWriteStarted: (() => void) | undefined;
    const waitForWriteStart = () => new Promise<void>((resolve) => {
      notifyWriteStarted = resolve;
    });
    const writer = {
      searchMemories: async () => ({ success: true as const, results: [] }),
      addMemory: async (content: string) => {
        calls.push(content);
        notifyWriteStarted?.();
        notifyWriteStarted = undefined;
        return await new Promise<{ success: true }>((resolve) => resolvers.push(resolve));
      },
    };
    const saver = createSessionDigestSaver(writer, { user: "user-group", project: "project-group" });
    const firstWriteStarted = waitForWriteStart();
    const first = saver.save("session-42", "[Session Digest]\nVersion one");
    const second = saver.save("session-42", "[Session Digest]\nVersion two");

    await firstWriteStarted;
    expect(calls).toEqual(["Version one"]);
    const secondWriteStarted = waitForWriteStart();
    resolvers.shift()?.({ success: true });
    await first;
    await secondWriteStarted;
    expect(calls).toEqual(["Version one", "Version two"]);
    resolvers.shift()?.({ success: true });
    expect(await second).toBe(true);
    expect(await saver.save("session-42", "[Session Digest]\nVersion two")).toBe(false);
  });

  test("drops an older idle snapshot that resolves after a newer refresh", async () => {
    const { calls, writer } = createWriter();
    const saver = createSessionDigestSaver(writer, { user: "user-group", project: "project-group" });
    const refresher = createSessionDigestRefresher(saver);
    const resolvers: Array<(digest: string) => void> = [];
    const loadDigest = () => new Promise<string>((resolve) => resolvers.push(resolve));

    const first = refresher.refresh("session-42", loadDigest);
    const second = refresher.refresh("session-42", loadDigest);
    resolvers[1]?.("[Session Digest]\nNewest snapshot");
    expect(await second).toBe(true);
    resolvers[0]?.("[Session Digest]\nStale snapshot");
    expect(await first).toBe(false);

    expect(calls.map((call) => call.content)).toEqual(["Newest snapshot"]);
  });
});
