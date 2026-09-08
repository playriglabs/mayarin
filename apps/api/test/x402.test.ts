import { describe, expect, test } from "bun:test";
import {
  AssetCapabilities,
  decodePaymentRequired,
  decodeSettleResponse,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
  type PaymentRequired,
  type SettleResponse,
  X402_VERSION,
  type X402Resource,
} from "@mayarin/x402";
import {
  EXAMPLE_PAYMENT_PAYLOAD,
  EXAMPLE_REQUIREMENTS,
  EXAMPLE_RESOURCE,
  exampleResource,
} from "@mayarin/x402/testing";
import { Hono } from "hono";
import type { Container } from "../src/container.ts";
import { errorHandler } from "../src/errors.ts";
import { FX_QUOTE_RESOURCE_ID, requirePayment, x402Routes } from "../src/routes/x402.ts";
import { X402Service } from "../src/services/x402.ts";

const REQUIRED: PaymentRequired = {
  x402Version: X402_VERSION,
  error: "PAYMENT-SIGNATURE header is required",
  resource: EXAMPLE_RESOURCE,
  accepts: [EXAMPLE_REQUIREMENTS],
};

const SETTLED: SettleResponse = {
  success: true,
  transaction: `0x${"ab".repeat(32)}`,
  network: EXAMPLE_REQUIREMENTS.network,
  payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
};

interface StubOptions {
  readonly settle?: (payment: PaymentPayload) => Promise<SettleResponse>;
  readonly listedResources?: readonly X402Resource[];
}

/** The calls a route made, so a test can assert what reached the service. */
interface Stub {
  readonly settled: PaymentPayload[];
  readonly verified: PaymentPayload[];
}

function containerWith(options: StubOptions = {}): { container: Container; stub: Stub } {
  const stub: Stub = { settled: [], verified: [] };
  const resource = exampleResource();

  const service = {
    async resourceById(id: string) {
      if (id !== resource.id) throw new Error(`unexpected resource ${id}`);
      return resource;
    },
    async listByMerchant(merchantId: string) {
      return merchantId === resource.merchantId ? [resource] : [];
    },
    async listListed(listOptions: {
      readonly limit: number;
      readonly cursor?: { readonly id: string; readonly createdAt: Date };
    }) {
      return (options.listedResources ?? [])
        .map((listed, index) => ({ resource: listed, createdAt: new Date(index) }))
        .filter(({ resource: listed, createdAt }) => {
          if (listOptions.cursor === undefined) return true;
          return (
            createdAt < listOptions.cursor.createdAt ||
            (createdAt.getTime() === listOptions.cursor.createdAt.getTime() &&
              listed.id < listOptions.cursor.id)
          );
        })
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.resource.id.localeCompare(left.resource.id),
        )
        .slice(0, listOptions.limit);
    },
    async paymentRequired() {
      return REQUIRED;
    },
    async verify(_resource: unknown, payment: PaymentPayload) {
      stub.verified.push(payment);
      return { isValid: true, payer: SETTLED.payer };
    },
    async settle(_resource: unknown, payment: PaymentPayload) {
      stub.settled.push(payment);
      const response = options.settle === undefined ? SETTLED : await options.settle(payment);
      return { response, intent: {} };
    },
  } as unknown as X402Service;

  return { container: { x402: service } as unknown as Container, stub };
}

function appFor(container: Container): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/x402", x402Routes(container));
  return app;
}

const header = (payment: PaymentPayload) =>
  Buffer.from(JSON.stringify(payment), "utf8").toString("base64");

describe("resource registration", () => {
  test("the gated FX quote has a fixed id, so the route and the row agree", () => {
    // A gate whose id came from configuration would 404 for a deployment that
    // spelt it differently, with nothing on the payer's side to say why.
    expect(FX_QUOTE_RESOURCE_ID).toBe("fx-quote");
  });

  test("registering probes the token instead of trusting the caller", async () => {
    const saved: X402Resource[] = [];
    const service = new X402Service({
      resources: {
        async findById() {
          return undefined;
        },
        async listByMerchant() {
          return [];
        },
        async save(resource: X402Resource) {
          saved.push(resource);
        },
      },
      capabilities: new AssetCapabilities({
        pairs: [],
        probes: [
          {
            chain: "arc-testnet",
            async probe(contract) {
              return {
                chain: "arc-testnet",
                contract,
                transferMethod: "eip3009",
                domain: { name: "USDC", version: "2" },
                supportsPermit: true,
              };
            },
          },
        ],
      }),
      // `register` reads the merchant's settlement asset to tell a same-asset
      // rail from a cross-asset one, and this resource offers the merchant's
      // own asset — so the cross-asset guard is not reached.
      settlementAssetOf: async () => "USDC",
      // Nothing below is reached by `register`; the seam is deliberately narrow.
    } as unknown as ConstructorParameters<typeof X402Service>[0]);

    const resource = await service.register({
      id: "fx-quote",
      merchantId: "M-1",
      url: "https://api.example.com/x402/fx/quote",
      price: { amount: 2000n, asset: "USD" },
      accepts: [
        {
          chain: "arc-testnet",
          asset: "USDC",
          contract: "0x3600000000000000000000000000000000000000",
          payTo: "0x0000000000000000000000000000000000000001",
        },
      ],
      maxTimeoutSeconds: 120,
    });

    // The caller named a token. The domain and the method came off the token.
    expect(resource.accepts[0]).toMatchObject({
      transferMethod: "eip3009",
      domain: { name: "USDC", version: "2" },
    });
    expect(saved).toHaveLength(1);
  });
});

describe("requirePayment", () => {
  function gated(container: Container): Hono {
    const app = new Hono();
    app.onError(errorHandler);
    app.get("/fx", requirePayment(container, "res_fx_quote"), (c) => c.json({ rate: "1.08" }));
    return app;
  }

  test("answers an unpaid request with 402 and the price in a header", async () => {
    const response = await gated(containerWith().container).request("/fx");

    expect(response.status).toBe(402);
    expect(decodePaymentRequired(response.headers.get(PAYMENT_REQUIRED_HEADER) ?? "")).toEqual(
      REQUIRED,
    );
  });

  // The header carries everything, which is what the HTTP transport specifies.
  // A client that cannot read it has not implemented x402 and would not
  // understand a JSON body either.
  test("sends no body with the 402", async () => {
    const response = await gated(containerWith().container).request("/fx");

    expect(await response.text()).toBe("");
  });

  test("serves the resource once a payment settles", async () => {
    const { container, stub } = containerWith();

    const response = await gated(container).request("/fx", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: header(EXAMPLE_PAYMENT_PAYLOAD) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rate: "1.08" });
    expect(stub.settled).toEqual([EXAMPLE_PAYMENT_PAYLOAD]);
  });

  // The client needs to tie the resource it received to the transaction that
  // paid for it, and the settlement header is the only place that link exists.
  test("returns the settlement alongside the resource", async () => {
    const response = await gated(containerWith().container).request("/fx", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: header(EXAMPLE_PAYMENT_PAYLOAD) },
    });

    expect(decodeSettleResponse(response.headers.get(PAYMENT_RESPONSE_HEADER) ?? "")).toEqual(
      SETTLED,
    );
  });

  // A handler that ran first would have to be undone when settlement failed,
  // and a resource server cannot un-serve a response.
  test("does not serve the resource when settlement throws", async () => {
    const { container } = containerWith({
      settle: () => Promise.reject(new Error("broadcast failed")),
    });
    let served = false;
    const app = new Hono();
    app.onError(errorHandler);
    app.get("/fx", requirePayment(container, "res_fx_quote"), (c) => {
      served = true;
      return c.json({ rate: "1.08" });
    });

    const response = await app.request("/fx", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: header(EXAMPLE_PAYMENT_PAYLOAD) },
    });

    expect(served).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  test("rejects a malformed payment header before reaching the service", async () => {
    const { container, stub } = containerWith();

    const response = await gated(container).request("/fx", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: "not base64 json" },
    });

    expect(response.status).toBe(400);
    expect(stub.settled).toEqual([]);
  });

  // An optional subsystem is absent rather than broken, and the honest answer
  // to a request for a resource this deployment cannot settle is that it does
  // not serve one.
  test("404s when this deployment does not run x402", async () => {
    const response = await gated({} as unknown as Container).request("/fx");

    expect(response.status).toBe(404);
  });
});

describe("discovery", () => {
  test("lists a merchant's payable resources", async () => {
    const response = await appFor(containerWith().container).request(
      "/x402/resources?merchant=mer_example",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resources: [
        {
          id: "res_fx_quote",
          url: "https://api.example.com/x402/fx/quote",
          description: "One oracle-guarded FX quote",
          mimeType: "application/json",
        },
      ],
    });
  });

  // Without a merchant the same path is the cross-merchant discovery index
  // (#273), and an unlisted resource never appears in it: the merchant's
  // opt-in is the whole point.
  test("without a merchant, lists only what is listed rather than refusing", async () => {
    const response = await appFor(containerWith().container).request("/x402/resources");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resources: [] });
  });

  test("returns listed resources across merchants and paginates without repetition", async () => {
    const listedResources = [
      exampleResource({ id: "res_alpha", merchantId: "mer_alpha", listed: true }),
      exampleResource({ id: "res_beta", merchantId: "mer_beta", listed: true }),
    ];
    const app = appFor(containerWith({ listedResources }).container);

    const first = await app.request("/x402/resources?limit=1");
    const firstBody = (await first.json()) as {
      resources: readonly { id: string }[];
      nextCursor?: string;
    };
    expect(first.status).toBe(200);
    expect(firstBody.resources).toHaveLength(1);
    expect(firstBody.nextCursor).toBeString();

    const second = await app.request(
      `/x402/resources?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
    );
    const secondBody = (await second.json()) as {
      resources: readonly { id: string }[];
      nextCursor?: string;
    };

    expect(second.status).toBe(200);
    expect(secondBody.resources).toHaveLength(1);
    expect(secondBody.nextCursor).toBeUndefined();
    expect(new Set([...firstBody.resources, ...secondBody.resources].map(({ id }) => id))).toEqual(
      new Set(["res_alpha", "res_beta"]),
    );
  });

  test("rejects malformed public-index pagination", async () => {
    const app = appFor(containerWith().container);

    const [cursor, limit] = await Promise.all([
      app.request("/x402/resources?cursor=not-a-cursor"),
      app.request("/x402/resources?limit=0"),
    ]);

    expect(cursor.status).toBe(400);
    expect(limit.status).toBe(400);
  });

  test("returns an empty list for a merchant with nothing payable", async () => {
    const response = await appFor(containerWith().container).request(
      "/x402/resources?merchant=mer_other",
    );

    expect(await response.json()).toEqual({ resources: [] });
  });

  test("quotes a resource without being asked for it", async () => {
    const response = await appFor(containerWith().container).request(
      "/x402/resources/res_fx_quote/payment-required",
    );

    expect(await response.json()).toEqual(REQUIRED);
  });
});

describe("facilitator endpoints", () => {
  const body = {
    x402Version: X402_VERSION,
    paymentPayload: EXAMPLE_PAYMENT_PAYLOAD,
    paymentRequirements: EXAMPLE_REQUIREMENTS,
  };

  async function post(container: Container, path: string, payload: unknown): Promise<Response> {
    return await appFor(container).request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  test("verify answers without settling", async () => {
    const { container, stub } = containerWith();

    const response = await post(container, "/x402/resources/res_fx_quote/verify", body);

    expect(await response.json()).toEqual({ isValid: true, payer: SETTLED.payer });
    expect(stub.verified).toHaveLength(1);
    expect(stub.settled).toEqual([]);
  });

  test("settle returns the settlement response", async () => {
    const { container } = containerWith();

    const response = await post(container, "/x402/resources/res_fx_quote/settle", body);

    expect(await response.json()).toEqual(SETTLED);
  });

  // Both paths run the payload through the same decoder, so a payload cannot be
  // structurally wrong over HTTP-as-JSON and accepted as a header.
  test("rejects a v1 payload on the JSON path, as the header path does", async () => {
    const { container } = containerWith();

    const response = await post(container, "/x402/resources/res_fx_quote/verify", {
      ...body,
      paymentPayload: { ...EXAMPLE_PAYMENT_PAYLOAD, x402Version: 1 },
    });

    expect(response.status).toBe(400);
  });

  test("rejects a body that is not the facilitator envelope", async () => {
    const { container } = containerWith();

    const response = await post(container, "/x402/resources/res_fx_quote/settle", { nope: true });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
