import { describe, expect, test } from "bun:test";
import { createDashboardHandler } from "../src/services/dashboard.js";

const handler = createDashboardHandler({
  tags: { user: "user-group", project: "project-group" },
  client: {
    getStatus: async () => ({ success: true as const, status: "ok", message: "healthy" }),
    getProfile: async () => ({
      success: true as const,
      profile: { static: ["Prefers concise responses"], dynamic: ["Uses Bun"] },
    }),
    listMemories: async (groupId: string) => ({
      success: true as const,
      memories: [{ id: `${groupId}-1`, summary: "Recorded memory", createdAt: "2026-07-23T00:00:00.000Z", metadata: {} }],
    }),
  },
  listReplays: () => [{ sessionId: "session-42", updatedAt: "2026-07-23T00:00:00.000Z", eventCount: 2 }],
  loadReplay: () => ({
    sessionId: "session-42",
    events: [{ id: "user-1", role: "user", at: "2026-07-23T00:00:00.000Z", content: "Remember this" }],
  }),
});

describe("dashboard handler", () => {
  test("renders a loopback-safe document and exposes overview data", async () => {
    const document = await handler(new Request("http://127.0.0.1:4318/"));
    const overview = await handler(new Request("http://127.0.0.1:4318/api/overview"));

    expect(document.status).toBe(200);
    expect(document.headers.get("content-security-policy")).toContain("default-src 'self'");
    const documentHtml = await document.text();
    expect(documentHtml).toContain("Graphiti Memory");
    expect(documentHtml).toContain('aria-live="polite"');
    expect(documentHtml).toContain("@media (max-width: 767px)");
    expect(documentHtml).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(documentHtml).toContain("data-selected");
    expect(documentHtml).toContain("if (sessionId !== selectedReplayId) return;");
    expect(documentHtml).toContain("try { const response = await fetch");
    expect(documentHtml).toContain("font-size:14px");
    expect(await overview.json()).toMatchObject({
      status: "ok",
      profile: { static: ["Prefers concise responses"] },
      replays: [{ sessionId: "session-42" }],
    });
  });

  test("reports unavailable profile and memory sources instead of presenting them as empty", async () => {
    const unavailableHandler = createDashboardHandler({
      tags: { user: "user-group", project: "project-group" },
      client: {
        getStatus: async () => ({ success: true, status: "ok", message: "healthy" }),
        getProfile: async () => ({ success: false, profile: null }),
        listMemories: async () => ({ success: false, memories: [] }),
      },
      listReplays: () => [],
      loadReplay: () => null,
    });

    const overview = await unavailableHandler(new Request("http://127.0.0.1:4318/api/overview"));
    expect(await overview.json()).toMatchObject({
      profileError: true,
      projectMemoriesError: true,
      userMemoriesError: true,
    });
  });

  test("returns an empty favicon response without a browser console error", async () => {
    const response = await handler(new Request("http://127.0.0.1:4318/favicon.ico"));
    expect(response.status).toBe(204);
  });

  test("rejects unsupported mutation requests", async () => {
    const response = await handler(new Request("http://127.0.0.1:4318/api/overview", { method: "POST" }));
    expect(response.status).toBe(405);
  });
});
