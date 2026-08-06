import { describe, expect, test } from "bun:test";
import { classifyMemoryScope } from "../src/services/memory-scope-router.js";

describe("memory scope routing", () => {
  test("routes an explicit persistent English response preference to user scope", () => {
    // Given
    const content = "Always answer me with concise technical explanations.";

    // When
    const scope = classifyMemoryScope(content);

    // Then
    expect(scope).toBe("user");
  });

  test("routes an explicit persistent Korean response preference to user scope", () => {
    // Given
    const content = "앞으로는 항상 답변을 간결하게 해주세요.";

    // When
    const scope = classifyMemoryScope(content);

    // Then
    expect(scope).toBe("user");
  });

  test("keeps repository-specific instructions in project scope", () => {
    // Given
    const content = "From now on, use Bun in this repository.";

    // When
    const scope = classifyMemoryScope(content);

    // Then
    expect(scope).toBe("project");
  });

  test("keeps service-specific instructions in project scope", () => {
    // Given
    const content = "Always use strict TypeScript for this service.";

    // When
    const scope = classifyMemoryScope(content);

    // Then
    expect(scope).toBe("project");
  });

  test("keeps Korean project-specific instructions in project scope", () => {
    // Given
    const content = "이 프로젝트에서는 앞으로 Bun을 사용해 주세요.";

    // When
    const scope = classifyMemoryScope(content);

    // Then
    expect(scope).toBe("project");
  });

  test("biases an ambiguous preference without a durability signal to project scope", () => {
    // Given
    const content = "I prefer concise answers.";

    // When
    const scope = classifyMemoryScope(content);

    // Then
    expect(scope).toBe("project");
  });

  test("keeps an explicit one-off Korean request in project scope", () => {
    // Given
    const content = "이번 답변만 간결하게 해주세요.";

    // When
    const scope = classifyMemoryScope(content);

    // Then
    expect(scope).toBe("project");
  });

  test("keeps a durable-sounding task instruction in project scope", () => {
    // Given
    const content = "Always answer concisely for this task.";

    // When
    const scope = classifyMemoryScope(content);

    // Then
    expect(scope).toBe("project");
  });
});
