import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildReplayTimeline,
  loadReplayTimeline,
  saveReplayTimeline,
} from "../src/services/replay.js";

describe("replay timeline", () => {
  test("persists a sanitized chronological user and assistant timeline", () => {
    const timeline = buildReplayTimeline("session-42", [
      {
        info: { id: "assistant-1", role: "assistant", sessionID: "session-42", time: { created: 200 } },
        parts: [{ type: "text", text: "Done <private>token</private> safely." }],
      },
      {
        info: { id: "user-1", role: "user", sessionID: "session-42", time: { created: 100 } },
        parts: [{ type: "text", text: "Please remember this preference." }],
      },
    ]);

    expect(timeline.events.map((event) => event.role)).toEqual(["user", "assistant"]);
    expect(timeline.events[1]?.content).toBe("Done [REDACTED] safely.");

    const root = mkdtempSync(join(tmpdir(), "opencode-graphiti-replay-"));
    try {
      saveReplayTimeline(timeline, root);
      expect(loadReplayTimeline("session-42", root)).toEqual(timeline);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a path-like session id", () => {
    expect(() => buildReplayTimeline("../escape", [])).toThrow("Invalid replay session id");
  });
});
