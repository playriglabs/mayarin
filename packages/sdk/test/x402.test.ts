import { describe, expect, test } from "bun:test";
import { decodePaymentRequired, X402_VERSION } from "@mayarin/x402";
import {
  EXAMPLE_PAYMENT_PAYLOAD,
  EXAMPLE_PAYMENT_REQUIRED,
  EXAMPLE_REQUIREMENTS,
  withAuthorization,
} from "@mayarin/x402/testing";
import {
  createReplayStore,
  createX402Gate,
  MayarinX402Error,
  type X402GateDecision,
  type X402ReplayStore,
} from "../src/x402.ts";

const BASE = "https://api.test";
const RESOURCE = "premium";
const QUOTE_URL = `${BASE}/x402/resources/${RESOURCE}/payment-required`;
const SETTLE_URL = `${BASE}/x402/resources/${RESOURCE}/settle`;

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
  readonly headers: Headers;
}

/**
 * A fake Mayarin answering the two facilitator calls the gate makes. Routes
 * answer `undefined` for "no such route", which the fake turns into a network
 * fault — the gate has exactly two URLs and a third being hit is a bug.
 */
function mayarin(routes: Record<string, () => Response | undefined>) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: new Headers(init?.headers),
    });
    const route = routes[`${init?.method ?? "GET"} ${url}`];
    const response = route?.();
    if (response === undefined) throw new TypeError("fetch failed");
    return response;
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const signatureOf = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

/** A gate over a fake Mayarin, with a clock that can be advanced by test. */
function gateOf(
  routes: Record<string, () => Response | undefined>,
  replays?: X402ReplayStore,
): {
  calls: Call[];
  decide: (signature?: string) => Promise<X402GateDecision>;
  advanceTo: (at: Date) => void;
  replays: X402ReplayStore;
} {
  const { calls, fetch } = mayarin(routes);
  let now = new Date(1_740_672_120 * 1000); // inside the example authorization's window
  const store = replays ?? createReplayStore(() => now);
  const gate = createX402Gate({
    baseUrl: BASE,
    resourceId: RESOURCE,
    fetch,
    replays: store,
    now: () => now,
  });
  return {
    calls,
    decide: (signature) => gate.decide(signature),
    advanceTo: (at) => {
      now = at;
    },
    replays: store,
  };
}

// A Response body is consumed once, so the settle route answers fresh.
const settled = (): Response =>
  json({
    success: true,
    transaction: "0xdce241e203e3de3fd1fcd2e2e421d5a7d97a5ff8174a3df2314a4bf73baf6c8b",
    network: "eip155:84532",
    amount: "10000",
  });

describe("unpaid requests", () => {
  test("a request without a signature fetches the price fresh and answers 402", async () => {
    const { calls, decide } = gateOf({
      [`GET ${QUOTE_URL}`]: () => json(EXAMPLE_PAYMENT_REQUIRED),
    });
    const decision = await decide();
    expect(decision.kind).toBe("payment-required");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: QUOTE_URL, method: "GET" });
    if (decision.kind !== "payment-required") throw new Error("unreachable");
    expect(decodePaymentRequired(decision.paymentRequiredHeader)).toEqual(EXAMPLE_PAYMENT_REQUIRED);
    // No merchant credential on the request path — the surface is keyless.
    expect(calls[0]?.headers.get("Authorization")).toBeNull();
  });

  test("an unknown resource fails closed with PRICE_UNAVAILABLE", async () => {
    const { decide } = gateOf({
      [`GET ${QUOTE_URL}`]: () =>
        json({ error: { code: "NOT_FOUND", message: "not found", retryable: false } }, 404),
    });
    const error = await decide().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MayarinX402Error);
    expect((error as MayarinX402Error).code).toBe("PRICE_UNAVAILABLE");
    expect((error as MayarinX402Error).retryable).toBe(true);
  });

  test("an unreachable Mayarin fails closed with PRICE_UNAVAILABLE", async () => {
    const { decide } = gateOf({});
    const error = await decide().catch((caught: unknown) => caught);
    expect((error as MayarinX402Error).code).toBe("PRICE_UNAVAILABLE");
  });
});

describe("signed requests", () => {
  test("a signature settles with no verify round-trip", async () => {
    const { calls, decide } = gateOf({
      [`POST ${SETTLE_URL}`]: () => settled(),
      [`GET ${QUOTE_URL}`]: () => json(EXAMPLE_PAYMENT_REQUIRED),
    });
    const decision = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    expect(decision.kind).toBe("settled");
    expect(calls.map((call) => call.url)).toEqual([SETTLE_URL]);
  });

  test("the settle body carries the facilitator envelope", async () => {
    const { calls, decide } = gateOf({
      [`POST ${SETTLE_URL}`]: () => settled(),
      [`GET ${QUOTE_URL}`]: () => json(EXAMPLE_PAYMENT_REQUIRED),
    });
    await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      x402Version: X402_VERSION,
      paymentPayload: EXAMPLE_PAYMENT_PAYLOAD,
      paymentRequirements: EXAMPLE_REQUIREMENTS,
    });
  });

  test("a malformed signature is answered as unpaid, with the reason", async () => {
    const { decide } = gateOf({ [`GET ${QUOTE_URL}`]: () => json(EXAMPLE_PAYMENT_REQUIRED) });
    const decision = await decide("bm90IGpzb24");
    expect(decision.kind).toBe("payment-required");
    if (decision.kind !== "payment-required") throw new Error("unreachable");
    expect(decision.paymentRequired.error).toContain("does not decode");
  });

  test("a nonce that is not 32 bytes is answered as unpaid", async () => {
    const { decide } = gateOf({ [`GET ${QUOTE_URL}`]: () => json(EXAMPLE_PAYMENT_REQUIRED) });
    const decision = await decide(signatureOf(withAuthorization({ nonce: "0x1234" })));
    expect(decision.kind).toBe("payment-required");
    if (decision.kind !== "payment-required") throw new Error("unreachable");
    expect(decision.paymentRequired.error).toContain("32 bytes");
  });

  test("a refused settle is answered with a fresh 402 carrying the reason", async () => {
    const { calls, decide } = gateOf({
      [`POST ${SETTLE_URL}`]: () =>
        json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "authorization is expired",
              retryable: false,
            },
          },
          400,
        ),
      [`GET ${QUOTE_URL}`]: () => json(EXAMPLE_PAYMENT_REQUIRED),
    });
    const decision = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    expect(decision.kind).toBe("payment-required");
    if (decision.kind !== "payment-required") throw new Error("unreachable");
    expect(decision.paymentRequired.error).toBe("authorization is expired");
    expect(calls.map((call) => call.url)).toEqual([SETTLE_URL, QUOTE_URL]);
  });

  test("an unsuccessful settle response is answered as unpaid", async () => {
    const { decide } = gateOf({
      [`POST ${SETTLE_URL}`]: () =>
        json({
          success: false,
          errorReason: "insufficient_balance",
          transaction: "",
          network: "eip155:84532",
        }),
      [`GET ${QUOTE_URL}`]: () => json(EXAMPLE_PAYMENT_REQUIRED),
    });
    const decision = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    expect(decision.kind).toBe("payment-required");
    if (decision.kind !== "payment-required") throw new Error("unreachable");
    expect(decision.paymentRequired.error).toBe("insufficient_balance");
  });

  test("a settle network fault throws SETTLE_UNAVAILABLE", async () => {
    const { decide } = gateOf({});
    const error = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD)).catch(
      (caught: unknown) => caught,
    );
    expect((error as MayarinX402Error).code).toBe("SETTLE_UNAVAILABLE");
  });
});

describe("the delivery policy", () => {
  const routes = {
    [`POST ${SETTLE_URL}`]: () => settled(),
    [`GET ${QUOTE_URL}`]: () => json(EXAMPLE_PAYMENT_REQUIRED),
  };

  test("a replayed signature re-serves without calling Mayarin", async () => {
    const { calls, decide } = gateOf(routes);
    const first = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    if (first.kind !== "settled") throw new Error("unreachable");
    first.remember({
      status: 200,
      headers: [{ name: "Content-Type", value: "application/json" }],
      body: new Uint8Array([1, 2, 3]),
    });

    const second = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    expect(second.kind).toBe("replayed");
    if (second.kind !== "replayed") throw new Error("unreachable");
    expect(second.served.body).toEqual(new Uint8Array([1, 2, 3]));
    // One settle, one quote: the replay made no call at all.
    expect(calls.map((call) => call.url)).toEqual([SETTLE_URL]);
  });

  test("a replay dies at the authorization's validBefore", async () => {
    const { calls, decide, advanceTo } = gateOf(routes);
    const first = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    if (first.kind !== "settled") throw new Error("unreachable");
    first.remember({ status: 200, headers: [], body: new Uint8Array() });

    advanceTo(new Date(1_740_672_155 * 1000)); // one second past validBefore
    const second = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    expect(second.kind).not.toBe("replayed");
    expect(calls.map((call) => call.url)).toEqual([SETTLE_URL, SETTLE_URL]);
  });

  test("the replay TTL is the authorization's validBefore, not the quote window", async () => {
    const puts: Date[] = [];
    const spy: X402ReplayStore = {
      get: () => undefined,
      put: (_key, _served, expiresAt) => {
        puts.push(expiresAt);
      },
    };
    const { decide } = gateOf(routes, spy);
    const first = await decide(signatureOf(EXAMPLE_PAYMENT_PAYLOAD));
    if (first.kind !== "settled") throw new Error("unreachable");
    first.remember({ status: 200, headers: [], body: new Uint8Array() });
    expect(puts).toEqual([new Date(1_740_672_154 * 1000)]);
  });
});
