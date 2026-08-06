import { describe, expect, test } from "bun:test";
import { redactForLog } from "../src/services/privacy.js";

describe("redactForLog", () => {
  test("returns only length and a short hash, never message characters", () => {
    // Given
    const text = "secret-token-abc123 project plan";

    // When
    const result = redactForLog(text);
    const serialized = JSON.stringify(result);

    // Then
    expect(result.redacted).toBe(true);
    expect(result.length).toBe(text.length);
    expect(result.hash8).toHaveLength(8);
    expect(serialized).not.toContain("secret-token-abc123");

    for (let start = 0; start + 8 <= text.length; start += 1) {
      const window = text.slice(start, start + 8);
      expect(serialized).not.toContain(window);
    }
  });

  test("is stable for identical input", () => {
    // Given
    const text = "secret-token-abc123 project plan";

    // When
    const first = redactForLog(text);
    const second = redactForLog(text);

    // Then
    expect(first.hash8).toBe(second.hash8);
    expect(first.length).toBe(second.length);
  });

  test("produces distinct hashes for distinct input", () => {
    // Given / When
    const first = redactForLog("secret-token-abc123 project plan");
    const second = redactForLog("an entirely different message body");

    // Then
    expect(first.hash8).not.toBe(second.hash8);
  });
});
