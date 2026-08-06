import { describe, expect, test } from "bun:test";
import {
  PREFERENCE_TAXONOMY,
  isPreferenceCandidate,
  renderProfileStatement,
  type PreferenceSelection,
} from "../src/services/preference-taxonomy.js";

const ALL_PREFERENCE_PAIRS = [
  { key: "response-verbosity", value: "concise" },
  { key: "response-verbosity", value: "balanced" },
  { key: "response-verbosity", value: "detailed" },
  { key: "explanation-depth", value: "minimal" },
  { key: "explanation-depth", value: "standard" },
  { key: "explanation-depth", value: "deep" },
  { key: "response-language", value: "match-user" },
  { key: "response-language", value: "english" },
  { key: "response-language", value: "korean" },
  { key: "planning-preference", value: "direct-execution" },
  { key: "planning-preference", value: "plan-first" },
  { key: "planning-preference", value: "ask-when-ambiguous" },
  { key: "testing-workflow", value: "tdd" },
  { key: "testing-workflow", value: "tests-after" },
  { key: "testing-workflow", value: "verify-only" },
  { key: "commit-review-workflow", value: "review-before-commit" },
  { key: "commit-review-workflow", value: "commit-after-verification" },
  { key: "commit-review-workflow", value: "no-automatic-commit" },
] as const satisfies readonly PreferenceSelection[];

const GRAPHITI_FACT_SENTINEL = "PROJECT_VOCABULARY_MUST_NOT_LEAK";

describe("preference taxonomy", () => {
  test("renders every allowlisted key and value deterministically without fact text", () => {
    // Given
    const expectedPairCount = Object.values(PREFERENCE_TAXONOMY)
      .reduce((count, values) => count + values.length, 0);

    // When
    const rendered = ALL_PREFERENCE_PAIRS.map(({ key, value }) => ({
      first: renderProfileStatement(key, value),
      second: renderProfileStatement(key, value),
    }));

    // Then
    expect(ALL_PREFERENCE_PAIRS).toHaveLength(expectedPairCount);
    for (const statement of rendered) {
      expect(statement.first).toBe(statement.second);
      expect(statement.first).not.toContain(GRAPHITI_FACT_SENTINEL);
    }
  });

  test("accepts a candidate containing only a closed preference pair and evidence references", () => {
    // Given
    const candidate: unknown = {
      key: "response-verbosity",
      value: "concise",
      state: "candidate",
      decayClass: "persistent",
      evidence: [{
        kind: "graphiti-fact",
        sourceId: "fact-123",
        observedAt: "2026-08-02T00:00:00.000Z",
      }],
    };

    // When
    const accepted = isPreferenceCandidate(candidate);

    // Then
    expect(accepted).toBe(true);
  });

  test("rejects out-of-taxonomy values and Graphiti fact text at runtime", () => {
    // Given
    const leakedValue: unknown = {
      key: "response-verbosity",
      value: GRAPHITI_FACT_SENTINEL,
      state: "candidate",
      decayClass: "persistent",
      evidence: [],
    };
    const embeddedFactText: unknown = {
      key: "response-verbosity",
      value: "concise",
      state: "candidate",
      decayClass: "persistent",
      evidence: [],
      fact: GRAPHITI_FACT_SENTINEL,
    };

    // When
    const leakedValueAccepted = isPreferenceCandidate(leakedValue);
    const embeddedFactTextAccepted = isPreferenceCandidate(embeddedFactText);

    // Then
    expect(leakedValueAccepted).toBe(false);
    expect(embeddedFactTextAccepted).toBe(false);
  });
});
