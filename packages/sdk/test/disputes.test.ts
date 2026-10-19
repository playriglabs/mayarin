import { describe, expect, test } from "bun:test";
import { createMayarin } from "../src/index.ts";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
}

function clientReturning(responseBody: unknown, status = 200) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return {
    calls,
    client: createMayarin({ baseUrl: "https://api.test", secretKey: "sk_test", fetch }),
  };
}

describe("disputes module", () => {
  test("list sends the status and limit as a query and returns the open count", async () => {
    const { client, calls } = clientReturning({ disputes: [], open: 2 });
    const result = await client.disputes.list({ status: "open", limit: 10 });

    expect(result.open).toBe(2);
    expect(calls[0]?.method).toBe("GET");
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/v1/disputes");
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  test("list with no options sends no query", async () => {
    const { client, calls } = clientReturning({ disputes: [], open: 0 });
    await client.disputes.list();
    expect(new URL(calls[0]?.url ?? "").search).toBe("");
  });

  test("get returns the dispute with its thread, and encodes the id", async () => {
    const { client, calls } = clientReturning({
      dispute: { id: "dsp_1", status: "open", messages: [{ id: "dsm_1", author: "payer" }] },
    });
    const dispute = await client.disputes.get("dsp_1/../x");

    expect(dispute.messages[0]?.author).toBe("payer");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/v1/disputes/dsp_1%2F..%2Fx");
  });

  test("reply posts the text and returns the saved message", async () => {
    const { client, calls } = clientReturning(
      { message: { id: "dsm_2", author: "merchant", body: "Tracking 123" } },
      201,
    );
    const message = await client.disputes.reply("dsp_1", "Tracking 123");

    expect(message).toMatchObject({ author: "merchant", body: "Tracking 123" });
    expect(calls[0]?.method).toBe("POST");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/v1/disputes/dsp_1/messages");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ body: "Tracking 123" });
  });
});
