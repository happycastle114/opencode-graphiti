import { describe, expect, test } from "bun:test";
import {
  isStorageWorthy,
  sanitizeTextForStorage,
} from "../src/services/storage-sanitizer.js";
import { formatContextForPrompt } from "../src/services/context.js";

describe("storage text sanitization", () => {
  test("removes injected Graphiti context while preserving the user message", () => {
    // Given
    const text = `[GRAPHITI MEMORY - Temporal Knowledge Graph]

User Preferences (stable):
- Prefers concise responses

Project Knowledge (entities & facts):
- [fact][recent] Uses Bun for tests
Please keep this genuine user sentence.`;

    // When
    const sanitized = sanitizeTextForStorage(text);

    // Then
    expect(sanitized).toBe("Please keep this genuine user sentence.");
  });

  test("removes every multiline system reminder block", () => {
    // Given
    const text = `Keep the first note.
<system-reminder>
Internal instruction one.
</system-reminder>

Keep the second note.
<SYSTEM-REMINDER>Internal instruction two.</SYSTEM-REMINDER>`;

    // When
    const sanitized = sanitizeTextForStorage(text);

    // Then
    expect(sanitized).toBe("Keep the first note.\n\nKeep the second note.");
  });

  test("removes the injected memory trigger block", () => {
    // Given
    const text = `Remember that releases use Bun.
[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the graphiti tool.

Extract the key information and save it.
DO NOT skip this step. The user explicitly asked you to remember.`;

    // When
    const sanitized = sanitizeTextForStorage(text);

    // Then
    expect(sanitized).toBe("Remember that releases use Bun.");
  });

  test("preserves genuine user quotes of Graphiti and memory-trigger markers", () => {
    // Given
    const text = `The documentation must quote '[GRAPHITI MEMORY - Temporal Knowledge Graph]' and '[MEMORY TRIGGER DETECTED]' exactly.`;

    // When
    const sanitized = sanitizeTextForStorage(text);

    // Then
    expect(sanitized).toBe(text);
  });

  test("removes multiline generated Graphiti and memory-trigger block continuations", () => {
    // Given
    const text = `[GRAPHITI MEMORY - Temporal Knowledge Graph]
Project Knowledge (entities & facts):
- generated fact that wraps
  onto this injected continuation line

[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the graphiti tool.
This generated instruction also wraps
across multiple injected lines.
DO NOT skip this step. The user explicitly asked you to remember.
Keep this genuine user sentence.`;

    // When
    const sanitized = sanitizeTextForStorage(text);

    // Then
    expect(sanitized).toBe("Keep this genuine user sentence.");
  });

  test("removes all multiline memory content from actual formatted Graphiti context", () => {
    // Given
    const formattedContext = formatContextForPrompt(
      null,
      { results: [] },
      {
        results: [{
          id: "conversation-turn",
          memory: "Conversation turn:\n\nUser: Preserve the current Graphiti version.\n\nAssistant: The migration plan remains verified.",
          similarity: null,
          type: "fact",
        }],
      },
    );

    // When
    const sanitized = sanitizeTextForStorage(formattedContext);

    // Then
    expect(sanitized).toBe("");
  });

  test("unwraps digest content and removes digest metadata", () => {
    // Given
    const text = `[Session Digest]
Session: session-42
Captured exchanges: 2
User: Use Bun for releases.
Assistant: The Bun release gate passed.

<session-digest>
Keep this durable project note.
</session-digest>

[Session Summary]
The release process is stable.`;

    // When
    const sanitized = sanitizeTextForStorage(text);

    // Then
    expect(sanitized).toBe(
      "User: Use Bun for releases.\nAssistant: The Bun release gate passed.\n\nKeep this durable project note.\n\nThe release process is stable.",
    );
  });

  test("normalizes whitespace left by removed blocks", () => {
    // Given
    const text = `  First line.


<system-reminder>noise</system-reminder>


  Second   line.  `;

    // When
    const sanitized = sanitizeTextForStorage(text);

    // Then
    expect(sanitized).toBe("First line.\n\nSecond line.");
  });
});

describe("storage worthiness", () => {
  test("rejects empty and injected-noise-only text", () => {
    // Given
    const candidates = [
      "",
      "   ",
      "<system-reminder>internal only</system-reminder>",
      "[GRAPHITI MEMORY - Temporal Knowledge Graph]\n\nProject Knowledge (entities & facts):\n- Injected fact",
      `[MEMORY TRIGGER DETECTED]
The user wants you to remember something.
DO NOT skip this step. The user explicitly asked you to remember.`,
      "[Session Digest]\nSession: session-42\nCaptured exchanges: 0",
    ];

    // When
    const results = candidates.map(isStorageWorthy);

    // Then
    expect(results).toEqual([false, false, false, false, false, false]);
  });

  test("accepts concise genuine content", () => {
    // Given
    const candidates = ["OK", "Use Bun.", "배포 완료"];

    // When
    const results = candidates.map(isStorageWorthy);

    // Then
    expect(results).toEqual([true, true, true]);
  });
});
