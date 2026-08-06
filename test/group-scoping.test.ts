import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { GraphitiClient } from "../src/services/graphiti-client.js";
import { GraphitiRestClient } from "../src/services/graphiti-rest-client.js";
import { InvalidGroupIdsError } from "../src/services/group-ids.js";

function spyOnFetch() {
  return spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ facts: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

async function expectInvalidGroupIds(search: Promise<unknown>): Promise<void> {
  let rejection: unknown;
  try {
    await search;
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeInstanceOf(InvalidGroupIdsError);
}

afterEach(() => {
  mock.restore();
});

describe("Graphiti group scoping", () => {
  test("REST fact search sends exactly one request scoped to a valid single group", async () => {
    // Given
    const groupId = "project-group";
    const fetchSpy = spyOnFetch();
    const client = new GraphitiRestClient();

    // When
    await client.searchFacts("deployment conventions", [groupId]);

    // Then
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestBody: unknown = JSON.parse(
      String(fetchSpy.mock.calls.at(0)?.[1]?.body)
    );
    expect(requestBody).toMatchObject({ group_ids: [groupId] });
  });

  test("REST fact search rejects an empty group list before a network request", async () => {
    // Given
    const fetchSpy = spyOnFetch();
    const client = new GraphitiRestClient();

    // When
    const search = client.searchFacts("deployment conventions", []);

    // Then
    await expectInvalidGroupIds(search);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("REST fact search rejects an empty group id before a network request", async () => {
    // Given
    const fetchSpy = spyOnFetch();
    const client = new GraphitiRestClient();

    // When
    const search = client.searchFacts("deployment conventions", [""]);

    // Then
    await expectInvalidGroupIds(search);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("REST fact search rejects whitespace-only group ids before a network request", async () => {
    // Given
    const fetchSpy = spyOnFetch();
    const client = new GraphitiRestClient();

    // When
    const search = client.searchFacts("deployment conventions", [" ", "\t"]);

    // Then
    await expectInvalidGroupIds(search);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("MCP fact search rejects an empty group list before session initialization", async () => {
    // Given
    const fetchSpy = spyOnFetch();
    const client = new GraphitiClient();

    // When
    const search = client.searchFacts("deployment conventions", []);

    // Then
    await expectInvalidGroupIds(search);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("MCP fact search rejects an empty group id before session initialization", async () => {
    // Given
    const fetchSpy = spyOnFetch();
    const client = new GraphitiClient();

    // When
    const search = client.searchFacts("deployment conventions", [""]);

    // Then
    await expectInvalidGroupIds(search);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
