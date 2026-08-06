import { describe, expect, test } from "bun:test";
import { decideMemoryDuplicate } from "../src/services/memory-deduplication.js";

const FIRST_LONG_EPISODE = [
  "[2026-08-01T10:00:00.000Z] User requested a focused deduplication module for Graphiti memory results.",
  "The implementation must preserve scored matches, normalize text deterministically, and detect timestamp-varying conversation episodes.",
  "It must remain conservative for short memories and return the existing memory identifier to the caller.",
].join(" ");

const SECOND_LONG_EPISODE = [
  "[2026-08-01T11:15:00.000Z] User requested a focused deduplication module for Graphiti memory results.",
  "The implementation must preserve scored matches, normalize text deterministically, and detect timestamp-varying conversation episodes.",
  "It must remain conservative for short memories and return the existing memory identifier to the caller.",
].join(" ");

describe("memory duplicate decision", () => {
  test("does not suppress changed content based only on a scored result", () => {
    // Given
    const candidates = [{ id: "memory-scored", similarity: 0.91 }];

    // When
    const decision = decideMemoryDuplicate({ content: "new memory", candidates });

    // Then
    expect(decision).toEqual({ kind: "distinct" });
  });

  test("does not treat the score threshold itself as a duplicate", () => {
    // Given
    const candidates = [{ id: "memory-threshold", memory: "different memory", similarity: 0.9 }];

    // When
    const decision = decideMemoryDuplicate({ content: "new memory", candidates });

    // Then
    expect(decision).toEqual({ kind: "distinct" });
  });

  test("detects a short normalized exact duplicate when similarity is null", () => {
    // Given
    const candidates = [{
      id: "memory-exact",
      memory: "  USE Bun\nfor package management  ",
      similarity: null,
    }];

    // When
    const decision = decideMemoryDuplicate({
      content: "use bun for package management",
      candidates,
    });

    // Then
    expect(decision).toEqual({
      kind: "duplicate",
      existingId: "memory-exact",
      reason: "normalized-exact",
    });
  });

  test("detects normalized containment only when both memories are sufficiently long", () => {
    // Given
    const content = "The release process uses Bun for dependency installation, focused tests, type checking, and production builds before publishing artifacts.";
    const candidates = [{
      id: "memory-contained",
      memory: `Project convention: ${content} This workflow is required for every release candidate.`,
      similarity: null,
    }];

    // When
    const decision = decideMemoryDuplicate({ content, candidates });

    // Then
    expect(decision).toEqual({
      kind: "duplicate",
      existingId: "memory-contained",
      reason: "normalized-containment",
    });
  });

  test("does not use containment for short memories", () => {
    // Given
    const candidates = [{
      id: "memory-short",
      memory: "Use Bun for releases",
      similarity: null,
    }];

    // When
    const decision = decideMemoryDuplicate({ content: "Use Bun", candidates });

    // Then
    expect(decision).toEqual({ kind: "distinct" });
  });

  test("does not suppress long content based on token overlap", () => {
    // Given
    const candidates = [{
      id: "memory-overlap",
      memory: FIRST_LONG_EPISODE,
      similarity: null,
    }];

    // When
    const decision = decideMemoryDuplicate({
      content: SECOND_LONG_EPISODE,
      candidates,
    });

    // Then
    expect(decision).toEqual({ kind: "distinct" });
  });

  test("does not suppress an enriched version when it contains an older candidate", () => {
    // Given
    const candidate = "The vendored chart is pinned to version 1.92.0 and its release checks use Bun.";

    // When
    const decision = decideMemoryDuplicate({
      content: `${candidate} The chart now upgrades to version 1.94.0 after a migration review.`,
      candidates: [{ id: "memory-old-version", memory: candidate, similarity: null }],
    });

    // Then
    expect(decision).toEqual({ kind: "distinct" });
  });

  test("keeps distinct long memories even when they share a conversation template", () => {
    // Given
    const candidates = [{
      id: "memory-distinct",
      memory: [
        "[2026-08-01T10:00:00.000Z] User requested a focused deduplication module for Graphiti memory results.",
        "The implementation must preserve scored matches, normalize text deterministically, and detect timestamp-varying conversation episodes.",
        "It must remain conservative for short memories and return the existing memory identifier to the caller.",
      ].join(" "),
      similarity: null,
    }];
    const content = [
      "[2026-08-01T11:15:00.000Z] User requested a Kubernetes storage migration for a production database.",
      "The rollout must create a verified backup, switch the persistent volume class, and confirm application health after Argo synchronization.",
      "It must preserve the existing route owner and include a documented rollback procedure for operators.",
    ].join(" ");

    // When
    const decision = decideMemoryDuplicate({ content, candidates });

    // Then
    expect(decision).toEqual({ kind: "distinct" });
  });

  test("ignores unscored results without memory text", () => {
    // Given
    const candidates = [{ id: "memory-empty", similarity: null }];

    // When
    const decision = decideMemoryDuplicate({ content: FIRST_LONG_EPISODE, candidates });

    // Then
    expect(decision).toEqual({ kind: "distinct" });
  });
});
