import { describe, expect, test } from "bun:test";
import { linkedGroupsFor } from "../src/services/tags.js";

describe("linked topic groups", () => {
  test("lesson repos also search teaching (default table)", () => {
    expect(linkedGroupsFor("project-happycastle114-python-lesson")).toEqual(["teaching"]);
    expect(linkedGroupsFor("project-happycastle114-classroom")).toEqual(["teaching"]);
  });

  test("other projects get nothing extra", () => {
    expect(linkedGroupsFor("project-sparcs-kaist-otlplus-app")).toEqual([]);
  });

  test("custom table is deduped and drops blanks and self", () => {
    expect(linkedGroupsFor("project-a-b", { "project-a-b": ["t", "t", " ", "project-a-b"] })).toEqual(["t"]);
  });
});
