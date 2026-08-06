import { describe, expect, test } from "bun:test";
import { asMessage, getText } from "../src/services/message-parts.js";

describe("message parts", () => {
  test("preserves synthetic metadata while parsing a message", () => {
    const message = asMessage({
      info: { id: "user-1", role: "user" },
      parts: [{ type: "text", text: "Injected context", synthetic: true }],
    });

    expect(message?.parts?.[0]?.synthetic).toBe(true);
  });

  test("excludes synthetic text by default", () => {
    const text = getText([
      { type: "text", text: "Injected context", synthetic: true },
      { type: "text", text: "User request" },
    ]);

    expect(text).toBe("User request");
  });

  test("includes synthetic text when explicitly requested", () => {
    const text = getText(
      [
        { type: "text", text: "Injected context", synthetic: true },
        { type: "text", text: "User request" },
      ],
      { includeSynthetic: true },
    );

    expect(text).toBe("Injected context\nUser request");
  });
});
