import { describe, expect, test } from "bun:test";
import { isMayarinError } from "@mayarin/shared";
import { type FetchLike, postGraphql } from "../src/graphql.ts";

const ENDPOINT = "https://example.test/subgraph";

function answering(status: number, headers: Record<string, string> = {}): FetchLike {
  return async () => new Response("{}", { status, headers });
}

async function detailsOf(fetch: FetchLike, apiKey?: string): Promise<Record<string, unknown>> {
  try {
    await postGraphql(ENDPOINT, "{ _meta { block { number } } }", fetch, undefined, apiKey);
  } catch (error) {
    if (isMayarinError(error)) return error.details;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("postGraphql", () => {
  test("sends the API key as a bearer token, and omits the header without one", async () => {
    const seen: (string | null)[] = [];
    const fetch: FetchLike = async (_url, init) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await postGraphql(ENDPOINT, "{ _meta { block { number } } }", fetch, undefined, "sekret");
    await postGraphql(ENDPOINT, "{ _meta { block { number } } }", fetch);

    expect(seen).toEqual(["Bearer sekret", null]);
  });

  test("a failure names the endpoint and never the key", async () => {
    const details = await detailsOf(answering(429, { "retry-after": "30" }), "sekret");

    expect(JSON.stringify(details)).not.toContain("sekret");
    expect(details).toMatchObject({ endpoint: ENDPOINT });
  });

  test("carries a rate limiter's delay-seconds form to the caller", async () => {
    await expect(detailsOf(answering(429, { "retry-after": "30" }))).resolves.toMatchObject({
      status: 429,
      retryAfterMs: 30_000,
    });
  });

  test("carries the HTTP-date form as a delay from now", async () => {
    const at = new Date(Date.now() + 60_000).toUTCString();
    const details = await detailsOf(answering(429, { "retry-after": at }));

    // Whole seconds in the header, so the delay lands near a minute, not on it.
    expect(details.retryAfterMs).toBeGreaterThan(58_000);
    expect(details.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  test("a date already past asks for no wait at all", async () => {
    const at = new Date(Date.now() - 60_000).toUTCString();

    await expect(detailsOf(answering(429, { "retry-after": at }))).resolves.toMatchObject({
      retryAfterMs: 0,
    });
  });

  test("a 429 with no header, and a non-429, carry no hint", async () => {
    await expect(detailsOf(answering(429))).resolves.not.toHaveProperty("retryAfterMs");
    await expect(detailsOf(answering(500, { "retry-after": "30" }))).resolves.not.toHaveProperty(
      "retryAfterMs",
    );
  });
});
