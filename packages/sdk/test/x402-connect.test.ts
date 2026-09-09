import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  decodePaymentRequired,
  decodeSettleResponse,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "@mayarin/x402";
import { EXAMPLE_PAYMENT_PAYLOAD, EXAMPLE_PAYMENT_REQUIRED } from "@mayarin/x402/testing";
import { createX402Gate } from "../src/x402.ts";
import { x402Connect } from "../src/x402-connect.ts";

/**
 * The adapter over a real socket: connect middleware is a `node:http` shape,
 * so it is tested against one. Mayarin is still faked — the gate's `fetch` is
 * injected, and the fake records what the payer's HTTP did.
 */
function startApp(routes: Record<string, () => Response | undefined>): Promise<Server> {
  const mayarin = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const route = routes[`${init?.method ?? "GET"} ${String(input)}`];
    const response = route?.();
    if (response === undefined) throw new TypeError("fetch failed");
    return response;
  };
  const gate = createX402Gate({
    baseUrl: "https://api.test",
    resourceId: "premium",
    fetch: mayarin as typeof globalThis.fetch,
    now: () => new Date(1_740_672_120 * 1000),
  });
  let handlerRuns = 0;

  const server = createServer((req, res) => {
    x402Connect(gate)(req, res, () => {
      handlerRuns++;
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ report: "premium" }));
    });
  });
  // Expose the counter through the server object the test holds.
  (server as Server & { handlerRuns: () => number }).handlerRuns = () => handlerRuns;

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const urlOf = (server: Server): string => {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const QUOTE_URL = "GET https://api.test/x402/resources/premium/payment-required";
const SETTLE_URL = "POST https://api.test/x402/resources/premium/settle";
// A Response body is consumed once, so every route answers with a fresh one.
const quote = (): Response => json(EXAMPLE_PAYMENT_REQUIRED);
const settle = (): Response =>
  json({
    success: true,
    transaction: "0xdce241e203e3de3fd1fcd2e2e421d5a7d97a5ff8174a3df2314a4bf73baf6c8b",
    network: "eip155:84532",
    amount: "10000",
  });

const signatureOf = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("x402Connect", () => {
  test("an unpaid request receives 402 with PAYMENT-REQUIRED and an empty body", async () => {
    const server = await startApp({ [QUOTE_URL]: quote });
    servers.push(server);
    const response = await fetch(urlOf(server));
    expect(response.status).toBe(402);
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).not.toBeNull();
    expect(decodePaymentRequired(response.headers.get(PAYMENT_REQUIRED_HEADER) ?? "")).toEqual(
      EXAMPLE_PAYMENT_REQUIRED,
    );
    expect(await response.text()).toBe("");
  });

  test("a paid request runs the handler once and carries PAYMENT-RESPONSE", async () => {
    const server = await startApp({
      [QUOTE_URL]: quote,
      [SETTLE_URL]: settle,
    });
    servers.push(server);
    const response = await fetch(urlOf(server), {
      headers: { [PAYMENT_SIGNATURE_HEADER]: signatureOf(EXAMPLE_PAYMENT_PAYLOAD) },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get(PAYMENT_RESPONSE_HEADER)).not.toBeNull();
    expect(decodeSettleResponse(response.headers.get(PAYMENT_RESPONSE_HEADER) ?? "").success).toBe(
      true,
    );
    expect((await response.json()).report).toBe("premium");
    expect((server as Server & { handlerRuns: () => number }).handlerRuns()).toBe(1);
  });

  test("a replayed signature re-serves the recorded response, handler not run again", async () => {
    const server = await startApp({
      [QUOTE_URL]: quote,
      [SETTLE_URL]: settle,
    });
    servers.push(server);
    const signature = signatureOf(EXAMPLE_PAYMENT_PAYLOAD);
    const first = await fetch(urlOf(server), {
      headers: { [PAYMENT_SIGNATURE_HEADER]: signature },
    });
    const firstBody = await first.text();
    const firstSettled = first.headers.get(PAYMENT_RESPONSE_HEADER);

    // The lost-response retry: the payer sends the identical signature again.
    const second = await fetch(urlOf(server), {
      headers: { [PAYMENT_SIGNATURE_HEADER]: signature },
    });
    expect(second.status).toBe(200);
    expect(second.headers.get(PAYMENT_RESPONSE_HEADER)).toBe(firstSettled);
    expect(await second.text()).toBe(firstBody);
    expect((server as Server & { handlerRuns: () => number }).handlerRuns()).toBe(1);
  });

  test("a tampered payment is refused with 402 and the handler never runs", async () => {
    const server = await startApp({
      [QUOTE_URL]: quote,
      [SETTLE_URL]: () =>
        json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "signature is not valid",
              retryable: false,
            },
          },
          400,
        ),
    });
    servers.push(server);
    const response = await fetch(urlOf(server), {
      headers: { [PAYMENT_SIGNATURE_HEADER]: signatureOf(EXAMPLE_PAYMENT_PAYLOAD) },
    });
    expect(response.status).toBe(402);
    expect((server as Server & { handlerRuns: () => number }).handlerRuns()).toBe(0);
  });

  test("a Mayarin outage answers 502 and the handler never runs", async () => {
    const server = await startApp({});
    servers.push(server);
    const response = await fetch(urlOf(server));
    expect(response.status).toBe(502);
    expect((server as Server & { handlerRuns: () => number }).handlerRuns()).toBe(0);
  });
});
