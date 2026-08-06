import { describe, expect, spyOn, test } from "bun:test";
import { GraphitiRestClient } from "../src/services/graphiti-rest-client.js";

describe("Graphiti REST fact provenance", () => {
  test("preserves episodes and expiration when the REST payload includes them", async () => {
    // Given
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      facts: [{
        uuid: "fact-1",
        name: "Fact 1",
        fact: "Graphiti preserves provenance",
        episodes: ["ep-1"],
        expired_at: "2026-08-01T00:00:00.000Z",
      }],
    }), { status: 200 }));
    const client = new GraphitiRestClient();

    try {
      // When
      const result = await client.searchFacts("provenance", ["project"]);

      // Then
      expect(result.facts[0]?.episodes).toEqual(["ep-1"]);
      expect(result.facts[0]?.expired_at).toBe("2026-08-01T00:00:00.000Z");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("leaves omitted provenance fields undefined", async () => {
    // Given
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      facts: [{
        uuid: "fact-2",
        name: "Fact 2",
        fact: "Graphiti omits absent provenance",
      }],
    }), { status: 200 }));
    const client = new GraphitiRestClient();

    try {
      // When
      const result = await client.searchFacts("provenance", ["project"]);

      // Then
      expect(result.facts[0]?.episodes).toBeUndefined();
      expect(result.facts[0]?.expired_at).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("builds a stable profile from only active, distinct facts", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      facts: [
        { uuid: "active-b", fact: "Prefers detailed responses" },
        { uuid: "expired", fact: "Prefers concise responses", expired_at: "2026-08-01T00:00:00.000Z" },
        { uuid: "active-a", fact: "Prefers concise responses" },
        { uuid: "duplicate", fact: "Prefers concise responses" },
        { uuid: "invalid", fact: "Prefers Korean responses", invalid_at: "2026-08-02T00:00:00.000Z" },
      ],
    }), { status: 200 }));
    const client = new GraphitiRestClient();

    try {
      const result = await client.getProfile("user");

      expect(result).toEqual({
        success: true,
        profile: {
          static: ["Prefers concise responses", "Prefers detailed responses"],
          dynamic: [],
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("does not misreport a failed profile search as an empty profile", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
    const client = new GraphitiRestClient();

    try {
      const result = await client.getProfile("user");

      expect(result.success).toBeFalse();
      if (!result.success) expect(result.error).toContain("HTTP 503");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
