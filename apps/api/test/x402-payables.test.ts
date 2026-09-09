import { describe, expect, test } from "bun:test";
import { CatalogService, type PaymentLink } from "@mayarin/catalog";
import { InMemoryPaymentLinkRepository, InMemoryProductRepository } from "@mayarin/catalog/testing";
import { LiquidityRouter, TablePriceSource } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { type Invoice, InvoiceService } from "@mayarin/invoicing";
import { InMemoryInvoiceRepository } from "@mayarin/invoicing/testing";
import { QuoteEngine } from "@mayarin/quote";
import { FakeOrderSigner } from "@mayarin/quote/testing";
import { type Money, money } from "@mayarin/shared";
import {
  AssetCapabilities,
  checkStatically,
  decodePaymentRequired,
  decodeSettleResponse,
  eip3009PayloadOf,
  facilitatorRegistry,
  idempotencyKeyOf,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type X402Facilitator,
} from "@mayarin/x402";
import {
  EXAMPLE_EIP3009_PAYLOAD,
  FakeFacilitator,
  FakeSettlementConfirmer,
  InMemoryPayableQuoteRepository,
  InMemoryResourceRepository,
} from "@mayarin/x402/testing";
import { Hono } from "hono";
import { createHarness } from "../../../packages/core/clearing/test/harness.ts";
import type { Container } from "../src/container.ts";
import { errorHandler } from "../src/errors.ts";
import { RuntimePriceSource } from "../src/market.ts";
import { x402Routes } from "../src/routes/x402.ts";
import { X402Service } from "../src/services/x402.ts";
import { X402PayableService } from "../src/services/x402-payables.ts";

const TX_HASH = `0x${"ab".repeat(32)}`;
const BASE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SETTLEMENT_ADDRESS = "0x596a7fb9857ca6c008dae1ba8e0e44c0eb38c1f5";
const NONCE_A = EXAMPLE_EIP3009_PAYLOAD.authorization.nonce;
const NONCE_B = `0x${"bb".repeat(32)}`;

/** The merchant every obligation in this suite belongs to. */
const MERCHANT = {
  id: "mrc_payables",
  name: "Warung Kopi Mayarin",
  city: "Jakarta",
  countryCode: "ID",
};

/** 100.00 USD — the total every invoice here is raised for. */
const HUNDRED_DOLLARS = money(10_000n, "USD");

function signatureOf(payment: PaymentPayload): { readonly [PAYMENT_SIGNATURE_HEADER]: string } {
  return { [PAYMENT_SIGNATURE_HEADER]: Buffer.from(JSON.stringify(payment)).toString("base64") };
}

/**
 * The fake facilitator, made honest about the one thing this suite needs it
 * for: a real facilitator refuses an authorization whose terms do not match
 * the requirements — an under-signed amount, a wrong recipient — *before*
 * broadcasting, and the payable flow leans on exactly that to refuse a partial
 * payment with nothing on the chain. The bare fake settles anything, so it
 * would turn every refusal test into a broadcast.
 */
function honest(fake: FakeFacilitator, clock: { now(): Date }): X402Facilitator {
  return {
    name: fake.name,
    supports: (requirements) => fake.supports(requirements),
    async verify(payment, requirements) {
      const reason = checkStatically(payment, requirements, clock.now());
      if (reason !== undefined) {
        return {
          isValid: false,
          invalidReason: reason,
          payer: eip3009PayloadOf(payment).authorization.from,
        };
      }
      return fake.verify(payment, requirements);
    },
    async settle(payment, requirements): Promise<SettleResponse> {
      const reason = checkStatically(payment, requirements, clock.now());
      if (reason !== undefined) {
        return {
          success: false,
          errorReason: reason,
          transaction: "",
          network: requirements.network,
          payer: eip3009PayloadOf(payment).authorization.from,
        };
      }
      return fake.settle(payment, requirements);
    },
  };
}

async function harness(options: { rails?: boolean } = {}) {
  const clearing = createHarness({ rates: { "USD/USDC": 1_000_000n, "IDR/USDC": 100n } });
  const oracle = new FixedPriceOracle([]);
  const quoteEngine = new QuoteEngine({
    venue: new TablePriceSource(),
    oracle,
    clock: clearing.clock,
    policy: { maxDeviationBps: 100, maxAgeMs: 60_000 },
    fiat: { pegged: ["USD/USDC"], maxAgeMs: 60_000, closedMaxAgeMs: 60_000, closedSpreadBps: 0 },
  });
  const rates = new LiquidityRouter({
    source: new RuntimePriceSource({
      quote: async () => ({
        engine: quoteEngine,
        oracle,
        venues: [],
        signer: new FakeOrderSigner(),
        slippageBps: 50,
        ttlSeconds: 60,
      }),
      rates: async () => new TablePriceSource(),
    }),
  });

  const facilitator = new FakeFacilitator().willSettleWith({
    success: true,
    transaction: TX_HASH,
    network: "eip155:84532",
  });
  const confirmer = new FakeSettlementConfirmer();
  const payableQuotes = new InMemoryPayableQuoteRepository();
  const x402 = new X402Service({
    resources: new InMemoryResourceRepository(),
    facilitators: facilitatorRegistry([honest(facilitator, clearing.clock)]),
    capabilities: new AssetCapabilities({
      pairs: [],
      probes: [
        {
          chain: "base-sepolia",
          async probe(contract) {
            return {
              chain: "base-sepolia",
              contract,
              transferMethod: "eip3009",
              domain: { name: "USDC", version: "2" },
              supportsPermit: true,
            };
          },
        },
      ],
    }),
    confirmers: new Map([["eip155:84532", confirmer]]),
    rates,
    intents: clearing.intents,
    engine: clearing.engine,
    clock: clearing.clock,
    quoteTtlSeconds: 60,
    merchantSnapshot: async (id) => ({ ...MERCHANT, id }),
    settlementAssetOf: async () => "USDC",
    merchantRails: {
      railsFor: async () =>
        options.rails === false
          ? []
          : [
              {
                chain: "base-sepolia",
                asset: "USDC",
                contract: BASE_USDC,
                payTo: SETTLEMENT_ADDRESS,
              },
            ],
    },
    payableQuotes,
  });

  // The real commerce services over the in-memory ports: the payable service is
  // the join point between them and the rail, and these tests exist to prove
  // the join — a fake on either side would test nothing but the fake.
  const invoiceRepository = new InMemoryInvoiceRepository();
  const invoices = new InvoiceService({
    invoices: invoiceRepository,
    // No hosted checkout happens in this suite; the seam is never called.
    checkout: {} as never,
    payments: clearing.repositories.intents,
    clock: clearing.clock,
  });
  const catalog = new CatalogService({
    products: new InMemoryProductRepository(),
    links: new InMemoryPaymentLinkRepository(),
    clock: clearing.clock,
  });
  const payables = new X402PayableService({
    x402,
    quotes: payableQuotes,
    invoices,
    links: catalog,
    clock: clearing.clock,
    quoteTtlSeconds: 60,
  });

  const container = {
    x402,
    x402Payables: payables,
    rates,
    config: {
      rateLimitRequests: 10_000,
      rateLimitWindowSeconds: 60,
      rateLimitClientIpSource: "socket",
      rateLimitBlockSeconds: 0,
      rateLimitMaxClients: 10_000,
    },
  } as unknown as Container;
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/x402", x402Routes(container));

  return {
    app,
    clearing,
    clock: clearing.clock,
    facilitator,
    confirmer,
    payableQuotes,
    invoices,
    catalog,
    payables,
    container,
  };
}

/** A raised, issued invoice for 100.00 USD, listed or not as asked. */
async function issuedInvoice(
  h: Awaited<ReturnType<typeof harness>>,
  options: { listed?: boolean } = {},
): Promise<Invoice> {
  const draft = await h.invoices.createInvoice({
    merchantId: MERCHANT.id,
    merchant: MERCHANT,
    buyer: { name: "PT Pembeli" },
    currency: "USD",
    lines: [{ name: "Kopi arabika", unitPrice: HUNDRED_DOLLARS, quantity: 1 }],
  });
  const issued = await h.invoices.issueInvoice(draft.id, {
    dueAt: new Date(h.clock.now().getTime() + 7 * 24 * 3600 * 1000),
  });
  return options.listed === true ? h.invoices.listInvoice(issued.id) : issued;
}

/** A fixed-amount payment link for 100.00 USD, listed or not as asked. */
async function fixedLink(
  h: Awaited<ReturnType<typeof harness>>,
  options: { listed?: boolean; rails?: PaymentLink["rails"] } = {},
): Promise<PaymentLink> {
  return h.catalog.createLink({
    kind: "fixed",
    merchant: MERCHANT,
    amount: HUNDRED_DOLLARS,
    title: "Satu kilo kopi",
    ...(options.listed === true ? { listed: true } : {}),
    ...(options.rails === undefined ? {} : { rails: options.rails }),
  });
}

/**
 * Records a completed payment against an invoice, the way a hosted checkout
 * would: an intent carrying the invoice's number, driven to COMPLETED through
 * the real clearing engine.
 */
async function payAgainst(
  h: Awaited<ReturnType<typeof harness>>,
  invoice: Invoice,
  amount: Money,
): Promise<void> {
  const created = await h.clearing.intents.create({
    merchant: MERCHANT,
    amount,
    source: { type: "manual" },
    ...(invoice.number === undefined ? {} : { merchantReference: invoice.number }),
    metadata: { invoiceId: invoice.id },
    payment: { asset: "USDC", chain: "base-sepolia" },
    executionPath: "deposit-match",
  });
  await h.clearing.engine.start(await h.clearing.intents.confirm(created.id));
}

/** The `402` for a payable, decoded off the header the transport specifies. */
async function quoteOf(
  h: Awaited<ReturnType<typeof harness>>,
  kind: "invoice" | "link",
  id: string,
): Promise<PaymentRequirements> {
  const response = await h.app.request(`/x402/payables/${kind}/${id}`);
  if (response.status !== 402) {
    throw new Error(`Expected a 402, got ${response.status}: ${await response.text()}`);
  }
  const required = decodePaymentRequired(response.headers.get(PAYMENT_REQUIRED_HEADER) ?? "");
  const accepted = required.accepts[0];
  if (accepted === undefined) throw new Error("The 402 offered no rail");
  return accepted;
}

/** An authorization for exactly `value` of `accepted`, under nonce `nonce`. */
function paymentOf(
  h: Awaited<ReturnType<typeof harness>>,
  accepted: PaymentRequirements,
  value: bigint,
  nonce: string,
): PaymentPayload {
  return {
    x402Version: 2,
    accepted,
    payload: {
      ...EXAMPLE_EIP3009_PAYLOAD,
      authorization: {
        ...EXAMPLE_EIP3009_PAYLOAD.authorization,
        value: value.toString(),
        to: accepted.payTo,
        nonce,
        validAfter: "0",
        validBefore: String(Math.floor(h.clock.now().getTime() / 1000) + 55),
      },
    },
  };
}

interface PayableIndexBody {
  readonly payables: readonly {
    readonly kind: "invoice" | "link";
    readonly id: string;
    readonly amount: { readonly amount: string; readonly asset: string };
    readonly url: string;
  }[];
  readonly nextCursor?: string;
}

async function payableIndex(
  h: Awaited<ReturnType<typeof harness>>,
  query = "",
): Promise<{ readonly response: Response; readonly body: PayableIndexBody }> {
  const response = await h.app.request(`/x402/payables${query}`);
  return { response, body: (await response.json()) as PayableIndexBody };
}

describe("x402 payables: discovery", () => {
  test("lists only obligations merchants opted in, with the amount an agent can pay", async () => {
    const h = await harness();
    const listedInvoice = await issuedInvoice(h, { listed: true });
    const hiddenInvoice = await issuedInvoice(h);
    const listedLink = await fixedLink(h, { listed: true });
    const hiddenLink = await fixedLink(h);

    const { response, body } = await payableIndex(h);

    expect(response.status).toBe(200);
    expect(new Set(body.payables.map(({ id }) => id))).toEqual(
      new Set([listedInvoice.id, listedLink.id]),
    );
    expect(body.payables.some(({ id }) => id === hiddenInvoice.id)).toBe(false);
    expect(body.payables.some(({ id }) => id === hiddenLink.id)).toBe(false);
    expect(body.payables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "invoice",
          id: listedInvoice.id,
          amount: expect.objectContaining({ amount: "10000", asset: "USD" }),
          url: `/x402/payables/invoice/${listedInvoice.id}`,
        }),
        expect.objectContaining({
          kind: "link",
          id: listedLink.id,
          amount: expect.objectContaining({ amount: "10000", asset: "USD" }),
          url: `/x402/payables/link/${listedLink.id}`,
        }),
      ]),
    );
  });

  test("shows an invoice's outstanding balance, not its original total", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h, { listed: true });
    await payAgainst(h, invoice, money(4_000n, "USD"));

    const { body } = await payableIndex(h);

    expect(body.payables).toEqual([
      expect.objectContaining({
        kind: "invoice",
        id: invoice.id,
        amount: expect.objectContaining({ amount: "6000", asset: "USD" }),
      }),
    ]);
  });

  test("stops advertising listed obligations once they are no longer payable", async () => {
    const h = await harness();
    const voided = await issuedInvoice(h, { listed: true });
    await h.invoices.voidInvoice(voided.id);
    const paid = await issuedInvoice(h, { listed: true });
    await payAgainst(h, paid, HUNDRED_DOLLARS);
    const disabled = await fixedLink(h, { listed: true });
    await h.catalog.disableLink(disabled.id);
    await h.catalog.createLink({
      kind: "open",
      merchant: MERCHANT,
      currency: "USD",
      listed: true,
    });

    const { body } = await payableIndex(h);

    expect(body.payables).toEqual([]);
  });

  test("walks a mixed invoice/link index without duplicates or skipped rows", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h, { listed: true });
    const firstLink = await fixedLink(h, { listed: true });
    const secondLink = await fixedLink(h, { listed: true });
    const seen: string[] = [];
    let cursor: string | undefined;

    do {
      const query =
        cursor === undefined ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const page = await payableIndex(h, query);
      expect(page.response.status).toBe(200);
      expect(page.body.payables).toHaveLength(1);
      seen.push(page.body.payables[0]?.id ?? "");
      cursor = page.body.nextCursor;
    } while (cursor !== undefined);

    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set([invoice.id, firstLink.id, secondLink.id]));
  });

  test("rejects malformed cursors and non-positive limits", async () => {
    const h = await harness();

    const [cursor, limit] = await Promise.all([
      h.app.request("/x402/payables?cursor=not-a-cursor"),
      h.app.request("/x402/payables?limit=0"),
    ]);

    expect(cursor.status).toBe(400);
    expect(limit.status).toBe(400);
  });
});

describe("x402 payables: quoting", () => {
  test("the 402 quotes the full outstanding balance on the merchant's own rail", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);

    const accepted = await quoteOf(h, "invoice", invoice.id);

    // 100.00 USD priced 1:1 into six-decimal USDC.
    expect(accepted.amount).toBe("100000000");
    expect(accepted.payTo).toBe(SETTLEMENT_ADDRESS);
    expect(accepted.asset).toBe(BASE_USDC);
    expect(accepted.network).toBe("eip155:84532");
  });

  test("a partially-paid invoice quotes what is still owed, not the total", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    await payAgainst(h, invoice, money(4_000n, "USD"));

    const accepted = await quoteOf(h, "invoice", invoice.id);

    expect(accepted.amount).toBe("60000000");
  });

  test("an unlisted invoice still answers: the id is the access control", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);

    const accepted = await quoteOf(h, "invoice", invoice.id);

    expect(accepted.amount).toBe("100000000");
  });

  test("a merchant with no rails has no payable, and says so", async () => {
    const h = await harness({ rails: false });
    const invoice = await issuedInvoice(h);

    const response = await h.app.request(`/x402/payables/invoice/${invoice.id}`);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "the merchant has no rails",
    );
  });

  test("a payment link's restriction also narrows its x402 payable rails", async () => {
    const h = await harness();
    const link = await fixedLink(h, {
      rails: [{ chain: "arc-testnet", asset: "USDC" }],
    });

    const response = await h.app.request(`/x402/payables/link/${link.id}`);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "none of the payment link's selected rails is currently offered",
    );
  });

  test("a draft, a voided invoice and one paid in full never quote", async () => {
    const h = await harness();
    const draft = await h.invoices.createInvoice({
      merchantId: MERCHANT.id,
      merchant: MERCHANT,
      buyer: { name: "PT Pembeli" },
      currency: "USD",
      lines: [{ name: "Kopi arabika", unitPrice: HUNDRED_DOLLARS, quantity: 1 }],
    });
    const voided = await issuedInvoice(h);
    await h.invoices.voidInvoice(voided.id);
    const paid = await issuedInvoice(h);
    await payAgainst(h, paid, HUNDRED_DOLLARS);

    const responses = await Promise.all(
      [draft.id, voided.id, paid.id].map((id) => h.app.request(`/x402/payables/invoice/${id}`)),
    );

    const messages = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
        return ((await response.json()) as { error: { message: string } }).error.message;
      }),
    );
    expect(messages[0]).toContain("is a draft");
    expect(messages[1]).toContain("has been voided");
    expect(messages[2]).toContain("already paid in full");
  });

  test("an open-amount link refuses: the agent cannot be the one naming the price", async () => {
    const h = await harness();
    const link = await h.catalog.createLink({
      kind: "open",
      merchant: MERCHANT,
      currency: "USD",
    });

    const response = await h.app.request(`/x402/payables/link/${link.id}`);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "names its own amount",
    );
  });

  test("a disabled link and an expired one never quote", async () => {
    const h = await harness();
    const disabled = await fixedLink(h);
    await h.catalog.disableLink(disabled.id);
    const expired = await h.catalog.createLink({
      kind: "fixed",
      merchant: MERCHANT,
      amount: HUNDRED_DOLLARS,
      expiresAt: new Date(h.clock.now().getTime() + 1_000),
    });
    h.clock.advance(2_000);

    const responses = await Promise.all(
      [disabled.id, expired.id].map((id) => h.app.request(`/x402/payables/link/${id}`)),
    );

    const messages = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(409);
        return ((await response.json()) as { error: { message: string } }).error.message;
      }),
    );
    expect(messages[0]).toContain("has been disabled");
    expect(messages[1]).toContain("has expired");
  });

  test("a catalog link is priced by the checkout, and refuses without one", async () => {
    const h = await harness();
    const product = await h.catalog.createProduct({
      merchantId: MERCHANT.id,
      name: "Kopi arabika",
      sku: "KOPA",
      prices: [HUNDRED_DOLLARS],
    });
    const link = await h.catalog.createLink({
      kind: "catalog",
      merchant: MERCHANT,
      currency: "USD",
      lines: [{ productId: product.id, quantity: 1 }],
    });

    const response = await h.app.request(`/x402/payables/link/${link.id}`);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "no checkout to price it",
    );
  });

  test("an unknown kind and an unknown obligation are refused plainly", async () => {
    const h = await harness();

    const unknownKind = await h.app.request("/x402/payables/voucher/inv_1");
    expect(unknownKind.status).toBe(400);
    expect(((await unknownKind.json()) as { error: { message: string } }).error.message).toContain(
      'Unknown x402 payable kind "voucher"',
    );

    const unknownInvoice = await h.app.request("/x402/payables/invoice/inv_nope");
    expect(unknownInvoice.status).toBe(404);

    const unknownLink = await h.app.request("/x402/payables/link/lnk_nope");
    expect(unknownLink.status).toBe(404);
  });
});

describe("x402 payables: settling an invoice", () => {
  test("pays the invoice in full, mints one intent carrying the provenance", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    const accepted = await quoteOf(h, "invoice", invoice.id);
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);
    h.confirmer.recordMatching(TX_HASH, accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);

    const response = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(payment),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { paymentIntent: string; payable: unknown };
    expect(body.payable).toEqual({ kind: "invoice", id: invoice.id });
    expect(
      decodeSettleResponse(response.headers.get(PAYMENT_RESPONSE_HEADER) ?? "").transaction,
    ).toBe(TX_HASH);

    const intent = await h.clearing.repositories.intents.findById(body.paymentIntent);
    expect(intent?.status).toBe("COMPLETED");
    expect(intent?.merchantReference).toBe(invoice.number);
    expect(intent?.metadata.x402PayableKind).toBe("invoice");
    expect(intent?.metadata.x402PayableId).toBe(invoice.id);
    expect(intent?.metadata.x402Nonce).toBe(NONCE_A);
    expect(intent?.metadata.invoiceId).toBe(invoice.id);

    // Exactly one intent for this payment, and the invoice it paid is closed.
    const keyed = await h.clearing.repositories.intents.findByIdempotencyKey(
      idempotencyKeyOf(payment),
    );
    expect(keyed?.id).toBe(body.paymentIntent);
    const view = await h.invoices.viewInvoice(invoice.id);
    expect(view.status).toBe("paid");
    expect(view.outstanding.amount).toBe(0n);
    expect(h.facilitator.settled).toHaveLength(1);
  });

  test("a partial authorization is refused and nothing is broadcast", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    const accepted = await quoteOf(h, "invoice", invoice.id);
    // Half the outstanding balance: an agent deciding to pay in part.
    const payment = paymentOf(h, accepted, 50_000_000n, NONCE_A);

    const response = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(payment),
    });

    // The refusal is the facilitator's, before anything is broadcast: the
    // authorization names an amount the requirements do not, and a real
    // facilitator — the honest fake here — refuses it as `invalid_amount`.
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "invalid_amount",
    );
    expect(h.facilitator.settled).toHaveLength(0);
    const view = await h.invoices.viewInvoice(invoice.id);
    expect(view.outstanding.amount).toBe(HUNDRED_DOLLARS.amount);
  });

  test("an authorization for a balance that moved since the quote is a 409", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    const accepted = await quoteOf(h, "invoice", invoice.id);
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);
    // A hosted checkout pays part of it after the agent was quoted.
    await payAgainst(h, invoice, money(4_000n, "USD"));

    const response = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(payment),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "is outstanding now",
    );
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("a settle with no quote outstanding is refused with the remedy", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    // Never quoted: the authorization terms are what the 402 would have said,
    // but no quote row was ever written for this obligation.
    const accepted: PaymentRequirements = {
      scheme: "exact",
      network: "eip155:84532",
      amount: "100000000",
      asset: BASE_USDC,
      payTo: SETTLEMENT_ADDRESS,
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
    };
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);

    const response = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(payment),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "No x402 quote is outstanding",
    );
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("an expired quote is a 410 carrying the remedy", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    const accepted = await quoteOf(h, "invoice", invoice.id);
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);
    // The lock was 60 seconds; the agent signed and returned a minute later.
    h.clock.advance(61_000);

    const response = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(payment),
    });

    expect(response.status).toBe(410);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "expired; request a new 402",
    );
    expect(h.facilitator.settled).toHaveLength(0);
  });

  test("a second authorization racing a live claim is a 409, and the first still pays", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    const accepted = await quoteOf(h, "invoice", invoice.id);
    const paymentA = paymentOf(h, accepted, 100_000_000n, NONCE_A);
    const paymentB = paymentOf(h, accepted, 100_000_000n, NONCE_B);
    // Agent A's settle claimed the row and is mid-broadcast when B arrives.
    const claim = await h.payableQuotes.claim("invoice", invoice.id, NONCE_A, h.clock.now());
    expect(claim.ok).toBe(true);

    const refused = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(paymentB),
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      "already being paid by another authorization",
    );
    expect(h.facilitator.settled).toHaveLength(0);

    h.confirmer.recordMatching(TX_HASH, accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);
    const paid = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(paymentA),
    });
    expect(paid.status).toBe(200);
    expect(h.facilitator.settled).toHaveLength(1);
    const view = await h.invoices.viewInvoice(invoice.id);
    expect(view.status).toBe("paid");
  });

  test("the same nonce replayed after the invoice is paid says so, and pays nothing again", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    const accepted = await quoteOf(h, "invoice", invoice.id);
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);
    h.confirmer.recordMatching(TX_HASH, accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);
    await h.app.request(`/x402/payables/invoice/${invoice.id}`, { headers: signatureOf(payment) });

    const replay = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(payment),
    });

    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: { message: string } }).error.message).toContain(
      "already paid in full",
    );
    expect(h.facilitator.settled).toHaveLength(1);
  });

  test("a settle whose confirmation failed resumes from the recorded broadcast", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    const accepted = await quoteOf(h, "invoice", invoice.id);
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);

    // The broadcast went out; the chain read failed. The nonce is spent.
    const stranded = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(payment),
    });
    expect(stranded.status).toBeGreaterThanOrEqual(500);

    h.confirmer.recordMatching(TX_HASH, accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);
    const resumed = await h.app.request(`/x402/payables/invoice/${invoice.id}`, {
      headers: signatureOf(payment),
    });

    expect(resumed.status).toBe(200);
    expect(h.facilitator.settled).toHaveLength(1);
    const view = await h.invoices.viewInvoice(invoice.id);
    expect(view.status).toBe("paid");
  });

  test("a sweep finishes an interrupted payable payment from its quote row", async () => {
    const h = await harness();
    const invoice = await issuedInvoice(h);
    const accepted = await quoteOf(h, "invoice", invoice.id);
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);

    await h.app.request(`/x402/payables/invoice/${invoice.id}`, { headers: signatureOf(payment) });
    const [stuck] = await h.clearing.engine.listResumable();
    expect(stuck?.providerReference).toBe(TX_HASH);

    h.confirmer.recordMatching(TX_HASH, accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);
    const recovered = await h.container.x402?.recoverBroadcasts();

    expect(recovered).toHaveLength(1);
    const view = await h.invoices.viewInvoice(invoice.id);
    expect(view.status).toBe("paid");
    expect(await h.clearing.engine.listResumable()).toHaveLength(0);
  });
});

describe("x402 payables: settling a payment link", () => {
  test("pays the link's total and mints one intent traceable to it", async () => {
    const h = await harness();
    const link = await fixedLink(h);
    const accepted = await quoteOf(h, "link", link.id);
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);
    h.confirmer.recordMatching(TX_HASH, accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);

    const response = await h.app.request(`/x402/payables/link/${link.id}`, {
      headers: signatureOf(payment),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { paymentIntent: string };
    const intent = await h.clearing.repositories.intents.findById(body.paymentIntent);
    expect(intent?.status).toBe("COMPLETED");
    expect(intent?.metadata.x402PayableKind).toBe("link");
    expect(intent?.metadata.x402PayableId).toBe(link.id);
    expect(intent?.metadata.paymentLinkId).toBe(link.id);
    expect(h.facilitator.settled).toHaveLength(1);
  });

  // A link has no paid state to refuse with, so this is where the replay
  // short-circuit is reachable: the completed intent answers from the record
  // and nothing is broadcast a second time.
  test("the same authorization replayed is idempotent", async () => {
    const h = await harness();
    const link = await fixedLink(h);
    const accepted = await quoteOf(h, "link", link.id);
    const payment = paymentOf(h, accepted, 100_000_000n, NONCE_A);
    h.confirmer.recordMatching(TX_HASH, accepted, EXAMPLE_EIP3009_PAYLOAD.authorization.from);
    const first = await h.app.request(`/x402/payables/link/${link.id}`, {
      headers: signatureOf(payment),
    });
    const firstBody = (await first.json()) as { paymentIntent: string };

    const replay = await h.app.request(`/x402/payables/link/${link.id}`, {
      headers: signatureOf(payment),
    });

    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { paymentIntent: string }).paymentIntent).toBe(
      firstBody.paymentIntent,
    );
    expect(h.facilitator.settled).toHaveLength(1);
  });
});
