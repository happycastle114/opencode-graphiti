import { describe, test, expect } from "bun:test";
import { resolveAgent } from "./agent-resolver.js";

const UNTRUSTED = new Set(["general"]);

describe("resolveAgent", () => {
  test("hint preserved when not untrusted", () => {
    const result = resolveAgent({
      hint: "prometheus",
      candidates: [],
      untrustedAgents: UNTRUSTED,
    });
    expect(result).toEqual({ agent: "prometheus", source: "hint" });
  });

  test("hint ignored when untrusted, falls back to trusted candidate", () => {
    const result = resolveAgent({
      hint: "general",
      candidates: [{ agent: "plan" }],
      untrustedAgents: UNTRUSTED,
    });
    expect(result).toEqual({ agent: "plan", source: "trusted-candidate" });
  });

  test("custom agent with slash preserved unchanged", () => {
    const result = resolveAgent({
      hint: "plan/prometheus/sisyphus",
      candidates: [],
      untrustedAgents: UNTRUSTED,
    });
    expect(result.agent).toBe("plan/prometheus/sisyphus");
    expect(result.source).toBe("hint");
  });

  test("all untrusted candidates, no fallback → none", () => {
    const result = resolveAgent({
      hint: undefined,
      candidates: [{ agent: "general" }, { agent: "general" }],
      untrustedAgents: UNTRUSTED,
      allowUntrustedFallback: false,
    });
    expect(result).toEqual({ agent: undefined, source: "none" });
  });

  test("all untrusted candidates, with fallback → untrusted-fallback", () => {
    const result = resolveAgent({
      hint: undefined,
      candidates: [{ agent: "general" }, { agent: "general" }],
      untrustedAgents: UNTRUSTED,
      allowUntrustedFallback: true,
    });
    expect(result).toEqual({ agent: "general", source: "untrusted-fallback" });
  });

  test("empty candidates and no hint → none", () => {
    const result = resolveAgent({
      hint: undefined,
      candidates: [],
      untrustedAgents: UNTRUSTED,
    });
    expect(result).toEqual({ agent: undefined, source: "none" });
  });

  test("scans newest-first: returns first trusted candidate, not oldest", () => {
    const result = resolveAgent({
      hint: undefined,
      candidates: [
        { agent: "general" },
        { agent: "build" },
        { agent: "plan" },
      ],
      untrustedAgents: UNTRUSTED,
    });
    expect(result).toEqual({ agent: "build", source: "trusted-candidate" });
  });
});
