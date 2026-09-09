import { describe, expect, test } from "bun:test";
import type { X402ResourceBody } from "@mayarin/api/dto";
import { createMayarin } from "../src/index.ts";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
  readonly headers: Headers;
}

function clientReturning(responseBody: unknown, status = 200) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: new Headers(init?.headers),
    });
    return new Response(status === 204 ? null : JSON.stringify(responseBody), {
      status,
      ...(status === 204 ? {} : { headers: { "Content-Type": "application/json" } }),
    });
  }) as typeof globalThis.fetch;
  return {
    calls,
    client: createMayarin({ baseUrl: "https://api.test", secretKey: "sk_test", fetch }),
  };
}

const BODY: X402ResourceBody = {
  id: "premium",
  url: "https://merchant.test/premium",
  price: { amount: "0.02", asset: "USD" },
  accepts: [
    {
      chain: "base-sepolia",
      asset: "USDC",
      contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x596a7fb9857ca6c008dae1ba8e0e44c0eb38c1f5",
    },
  ],
  maxTimeoutSeconds: 600,
};

describe("x402 resources module", () => {
  test("register posts the body to /v1/x402/resources", async () => {
    const resource = { id: "premium", url: BODY.url };
    const { calls, client } = clientReturning({ resource }, 201);
    const result = await client.x402.resources.register(BODY);
    expect(result.id).toBe("premium");
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/x402/resources",
      method: "POST",
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ id: "premium" });
  });

  test("register is a write, so it carries an idempotency key", async () => {
    const { calls, client } = clientReturning({ resource: {} }, 201);
    await client.x402.resources.register(BODY);
    expect(calls[0]?.headers.get("Idempotency-Key")).toMatch(/.+/);
  });

  test("list unwraps this merchant's resources", async () => {
    const { calls, client } = clientReturning({ resources: [{ id: "premium" }, { id: "fx" }] });
    const result = await client.x402.resources.list();
    expect(result).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/x402/resources",
      method: "GET",
    });
  });

  test("remove issues a DELETE to the encoded resource path", async () => {
    const { calls, client } = clientReturning(undefined, 204);
    await client.x402.resources.remove("pre mium");
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/x402/resources/pre%20mium",
      method: "DELETE",
    });
  });

  test("a 204 delete resolves to undefined", async () => {
    const { client } = clientReturning(undefined, 204);
    const result = await client.x402.resources.remove("premium");
    expect(result).toBeUndefined();
  });

  test("listInIndex and unlistFromIndex post to their subpaths", async () => {
    const list = clientReturning({ resource: { id: "premium", listed: true } });
    const unlist = clientReturning({ resource: { id: "premium", listed: false } });
    const listed = await list.client.x402.resources.listInIndex("premium");
    const unlisted = await unlist.client.x402.resources.unlistFromIndex("premium");
    expect(listed.listed).toBe(true);
    expect(unlisted.listed).toBe(false);
    expect(list.calls[0]?.url).toBe("https://api.test/v1/x402/resources/premium/list");
    expect(unlist.calls[0]?.url).toBe("https://api.test/v1/x402/resources/premium/unlist");
  });
});
