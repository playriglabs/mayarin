import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import { buildPaymentRequired, isPayableKind, type PayableQuote } from "../src/index.ts";
import {
  atomic,
  InMemoryPayableQuoteRepository,
  priced,
  USDC_ARC_TESTNET,
} from "../testing/index.ts";

const NOW = new Date("2026-09-08T09:00:00.000Z");
const LATER = new Date(NOW.getTime() + 30_000);

/** A payable quote in the shape the payable service builds one. */
function exampleQuote(overrides: Partial<PayableQuote> = {}): PayableQuote {
  return {
    kind: "invoice",
    obligationId: "inv_123",
    merchantId: "mer_example",
    amount: atomic(1_500n, "IDR"),
    accepts: [USDC_ARC_TESTNET],
    expiresAt: LATER,
    status: "quoted",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("isPayableKind", () => {
  test("admits the two obligation kinds and nothing else", () => {
    expect(isPayableKind("invoice")).toBe(true);
    expect(isPayableKind("link")).toBe(true);
    expect(isPayableKind("cart")).toBe(false);
    expect(isPayableKind("resource")).toBe(false);
  });
});

describe("buildPaymentRequired over a payable offer", () => {
  test("a payable-shaped offer produces the same spec-shaped 402 a resource does", () => {
    // An invoice's outstanding balance, quoted into the rails the merchant
    // accepts — the same `402` a resource produces, wearing an obligation's
    // price instead of a registry row's.
    const required = buildPaymentRequired(
      {
        id: "invoice/inv_123",
        merchantId: "mer_example",
        url: "/x402/payables/invoice/inv_123",
        description: "Invoice INV-2026-09-001",
        price: atomic(1_500n, "IDR"),
        accepts: [USDC_ARC_TESTNET],
        maxTimeoutSeconds: 60,
      },
      [priced(USDC_ARC_TESTNET, atomic(11_500n, "USDC"), NOW, 60)],
      NOW,
    );

    expect(required.x402Version).toBe(2);
    expect(required.resource.url).toBe("/x402/payables/invoice/inv_123");
    expect(required.resource.description).toBe("Invoice INV-2026-09-001");
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]?.scheme).toBe("exact");
  });

  test("the offer's ceiling, not the quote lock, bounds the timeout", () => {
    // The payable's `maxTimeoutSeconds` is the quote lock itself — one number,
    // so the two cannot drift. A shorter priced lock still wins, exactly as it
    // does for a resource.
    const required = buildPaymentRequired(
      {
        id: "link/lnk_456",
        merchantId: "mer_example",
        url: "/x402/payables/link/lnk_456",
        price: atomic(1_500n, "IDR"),
        accepts: [USDC_ARC_TESTNET],
        maxTimeoutSeconds: 60,
      },
      [priced(USDC_ARC_TESTNET, atomic(11_500n, "USDC"), NOW, 30)],
      NOW,
    );

    expect(required.accepts[0]?.maxTimeoutSeconds).toBe(30);
  });

  test("refuses an offer priced against an expired quote", () => {
    expect(() =>
      buildPaymentRequired(
        {
          id: "invoice/inv_123",
          merchantId: "mer_example",
          url: "/x402/payables/invoice/inv_123",
          price: atomic(1_500n, "IDR"),
          accepts: [USDC_ARC_TESTNET],
          maxTimeoutSeconds: 60,
        },
        [priced(USDC_ARC_TESTNET, atomic(11_500n, "USDC"), NOW, -1)],
        NOW,
      ),
    ).toThrow(ValidationError);
  });
});

describe("InMemoryPayableQuoteRepository", () => {
  test("a fresh claim passes, a second different nonce is refused", async () => {
    const quotes = new InMemoryPayableQuoteRepository();
    await quotes.save(exampleQuote(), { now: NOW });

    const first = await quotes.claim("invoice", "inv_123", "0x01", NOW);
    expect(first.ok).toBe(true);

    const second = await quotes.claim("invoice", "inv_123", "0x02", NOW);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("claimed-by-other");
      expect(second.quote?.claimedNonce).toBe("0x01");
    }
  });

  test("the same nonce resumes even past expiry — the chain already holds it", async () => {
    const quotes = new InMemoryPayableQuoteRepository();
    await quotes.save(exampleQuote(), { now: NOW });
    await quotes.claim("invoice", "inv_123", "0x01", NOW);

    // A crash between broadcast and confirm; the retry arrives after the quote's
    // own window closed. The nonce is spent on-chain, so refusing here would
    // strand money no other path can recover.
    const afterExpiry = new Date(LATER.getTime() + 60_000);
    const resume = await quotes.claim("invoice", "inv_123", "0x01", afterExpiry);
    expect(resume.ok).toBe(true);
  });

  test("a different nonce after expiry is refused as expired, not claimed", async () => {
    const quotes = new InMemoryPayableQuoteRepository();
    await quotes.save(exampleQuote(), { now: NOW });
    await quotes.claim("invoice", "inv_123", "0x01", NOW);

    const afterExpiry = new Date(LATER.getTime() + 60_000);
    const result = await quotes.claim("invoice", "inv_123", "0x02", afterExpiry);
    // The claim lapsed with the quote: an abandoned authorization blocks only
    // until the quote's window closes, then the obligation is payable again.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  test("an unclaimed quote past its expiry is refused as expired", async () => {
    const quotes = new InMemoryPayableQuoteRepository();
    await quotes.save(exampleQuote(), { now: NOW });

    const result = await quotes.claim("invoice", "inv_123", "0x01", LATER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  test("a claim against an unknown obligation is missing", async () => {
    const quotes = new InMemoryPayableQuoteRepository();
    const result = await quotes.claim("link", "lnk_404", "0x01", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing");
  });

  test("a refresh does not clobber a live claim, but does reset a spent row", async () => {
    const quotes = new InMemoryPayableQuoteRepository();
    await quotes.save(exampleQuote(), { now: NOW });
    await quotes.claim("invoice", "inv_123", "0x01", NOW);

    // A second agent asks for a 402 while the first authorization is in
    // flight. The stored row is served unchanged — the claim survives.
    await quotes.save(
      exampleQuote({ amount: atomic(999n, "IDR"), expiresAt: new Date(NOW.getTime() + 120_000) }),
      { now: NOW },
    );
    const served = await quotes.find("invoice", "inv_123");
    expect(served?.amount.amount).toBe(1_500n);
    expect(served?.claimedNonce).toBe("0x01");

    // Once the claim's window lapses, the next 402 resets the row and the
    // obligation is payable again under a fresh quote.
    const afterExpiry = new Date(LATER.getTime() + 60_000);
    await quotes.save(
      exampleQuote({
        amount: atomic(1_200n, "IDR"),
        expiresAt: new Date(afterExpiry.getTime() + 60_000),
      }),
      { now: afterExpiry },
    );
    const reset = await quotes.find("invoice", "inv_123");
    expect(reset?.amount.amount).toBe(1_200n);
    expect(reset?.status).toBe("quoted");
    expect(reset?.claimedNonce).toBeUndefined();
  });

  test("a settled row resets on the next quote", async () => {
    const quotes = new InMemoryPayableQuoteRepository();
    await quotes.save(exampleQuote(), { now: NOW });
    await quotes.claim("invoice", "inv_123", "0x01", NOW);
    await quotes.markSettled("invoice", "inv_123", NOW);

    const settled = await quotes.find("invoice", "inv_123");
    expect(settled?.status).toBe("settled");

    await quotes.save(exampleQuote({ expiresAt: new Date(NOW.getTime() + 120_000) }), { now: NOW });
    const again = await quotes.find("invoice", "inv_123");
    expect(again?.status).toBe("quoted");
  });
});
