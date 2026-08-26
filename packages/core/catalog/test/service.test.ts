import { describe, expect, test } from "bun:test";
import { PaymentIntentService } from "@mayarin/payment-intent";
import { InMemoryPaymentIntentRepository } from "@mayarin/payment-intent/testing";
import {
  ConflictError,
  FixedClock,
  IdempotencyConflictError,
  InvalidStateTransitionError,
  money,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import { CART_METADATA_KEY } from "../src/cart.ts";
import { CatalogService, CheckoutService } from "../src/service.ts";
import { InMemoryPaymentLinkRepository, InMemoryProductRepository } from "../testing/index.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const merchant = { id: "mrc_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };
const other = { ...merchant, id: "mrc_2" };

function harness() {
  const clock = new FixedClock(NOW);
  const products = new InMemoryProductRepository();
  const links = new InMemoryPaymentLinkRepository();
  const intents = new PaymentIntentService({
    repository: new InMemoryPaymentIntentRepository(),
    clock,
    defaults: {
      settlementAsset: "USDC",
      provider: "mock",
      executionPath: "deposit-match",
      ttlSeconds: 900,
    },
  });

  return {
    clock,
    intents,
    catalog: new CatalogService({ products, links, clock }),
    commerce: new CheckoutService({ products, links, intents, clock }),
  };
}

function coffee(catalog: CatalogService) {
  return catalog.createProduct({
    merchantId: merchant.id,
    sku: "KOPI-01",
    name: "Kopi Susu",
    prices: [money(2_500_000n, "IDR"), money(750n, "MYR")],
  });
}

describe("CatalogService products", () => {
  test("refuses a duplicate SKU for the same merchant", async () => {
    const { catalog } = harness();
    await coffee(catalog);
    await expect(coffee(catalog)).rejects.toBeInstanceOf(ConflictError);
  });

  test("the same SKU is free for a different merchant", async () => {
    const { catalog } = harness();
    await coffee(catalog);
    const twin = await catalog.createProduct({
      merchantId: other.id,
      sku: "KOPI-01",
      name: "Kopi Susu",
      prices: [money(2_500_000n, "IDR")],
    });
    expect(twin.merchantId).toBe(other.id);
  });

  test("an unknown product is a NotFoundError", async () => {
    const { catalog } = harness();
    await expect(catalog.getProduct("prd_missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("CheckoutService — cart", () => {
  test("folds catalog and ad-hoc lines into one intent", async () => {
    const { catalog, commerce } = harness();
    const product = await coffee(catalog);

    const intent = await commerce.checkoutCart({
      merchant,
      currency: "IDR",
      lines: [
        { productId: product.id, quantity: 2 },
        { name: "Roti", unitPrice: money(1_200_000n, "IDR"), quantity: 1 },
      ],
    });

    expect(intent.amount).toEqual(money(6_200_000n, "IDR"));
    expect(intent.merchant.id).toBe(merchant.id);
  });

  test("freezes the line items onto the intent as a snapshot", async () => {
    const { catalog, commerce } = harness();
    const product = await coffee(catalog);

    const intent = await commerce.checkoutCart({
      merchant,
      currency: "IDR",
      lines: [{ productId: product.id, quantity: 1 }],
    });

    const snapshot = JSON.parse(intent.metadata[CART_METADATA_KEY] ?? "{}");
    expect(snapshot.lines).toEqual([
      { productId: product.id, name: "Kopi Susu", unitPrice: "2500000", quantity: 1 },
    ]);
  });

  test("a later price edit cannot reach back into an intent already minted", async () => {
    const { catalog, commerce } = harness();
    const product = await coffee(catalog);

    const intent = await commerce.checkoutCart({
      merchant,
      currency: "IDR",
      lines: [{ productId: product.id, quantity: 1 }],
    });
    await catalog.updateProduct(product.id, { prices: [money(9_900_000n, "IDR")] });

    expect(intent.amount).toEqual(money(2_500_000n, "IDR"));
  });

  test("prices the same cart in a second currency", async () => {
    const { catalog, commerce } = harness();
    const product = await coffee(catalog);

    const intent = await commerce.checkoutCart({
      merchant,
      currency: "MYR",
      lines: [{ productId: product.id, quantity: 2 }],
    });

    expect(intent.amount).toEqual(money(1_500n, "MYR"));
  });

  test("refuses a currency the product is not priced in rather than converting", async () => {
    const { catalog, commerce } = harness();
    const product = await coffee(catalog);

    await expect(
      commerce.checkoutCart({
        merchant,
        currency: "THB",
        lines: [{ productId: product.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("refuses another merchant's product", async () => {
    const { catalog, commerce } = harness();
    const product = await coffee(catalog);

    await expect(
      commerce.checkoutCart({
        merchant: other,
        currency: "IDR",
        lines: [{ productId: product.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("refuses a retired product", async () => {
    const { catalog, commerce } = harness();
    const product = await coffee(catalog);
    await catalog.updateProduct(product.id, { active: false });

    await expect(
      commerce.checkoutCart({
        merchant,
        currency: "IDR",
        lines: [{ productId: product.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("carries the merchant reference through to the intent", async () => {
    const { commerce } = harness();
    const intent = await commerce.checkoutCart({
      merchant,
      currency: "IDR",
      lines: [{ name: "Roti", unitPrice: money(1_200_000n, "IDR"), quantity: 1 }],
      merchantReference: "INV-1042",
    });
    expect(intent.merchantReference).toBe("INV-1042");
  });

  test("replaying an idempotency key returns the same intent", async () => {
    const { commerce } = harness();
    const command = {
      merchant,
      currency: "IDR" as const,
      lines: [{ name: "Roti", unitPrice: money(1_200_000n, "IDR"), quantity: 1 }],
      idempotencyKey: "cart-key-0001",
    };

    const first = await commerce.checkoutCart(command);
    const second = await commerce.checkoutCart(command);
    expect(second.id).toBe(first.id);
  });
});

describe("CheckoutService — links", () => {
  test("a fixed link mints an intent for its own amount", async () => {
    const { catalog, commerce } = harness();
    const link = await catalog.createLink({
      kind: "fixed",
      merchant,
      amount: money(5_000_000n, "IDR"),
      title: "Paket Hemat",
    });

    const intent = await commerce.checkoutLink(link.id);
    expect(intent.amount).toEqual(money(5_000_000n, "IDR"));
    expect(intent.metadata.paymentLinkId).toBe(link.id);
  });

  test("a fixed link refuses an amount the buyer supplied", async () => {
    const { catalog, commerce } = harness();
    const link = await catalog.createLink({
      kind: "fixed",
      merchant,
      amount: money(5_000_000n, "IDR"),
    });

    await expect(
      commerce.checkoutLink(link.id, { amount: money(1n, "IDR") }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("an open link takes the amount the buyer enters", async () => {
    const { catalog, commerce } = harness();
    const link = await catalog.createLink({ kind: "open", merchant, currency: "IDR" });

    const intent = await commerce.checkoutLink(link.id, { amount: money(3_300_000n, "IDR") });
    expect(intent.amount).toEqual(money(3_300_000n, "IDR"));
  });

  test("an open link mints a fresh intent per sale — the counter-QR property", async () => {
    const { catalog, commerce } = harness();
    const link = await catalog.createLink({ kind: "open", merchant, currency: "IDR" });

    const first = await commerce.checkoutLink(link.id, { amount: money(1_000_000n, "IDR") });
    const second = await commerce.checkoutLink(link.id, { amount: money(2_000_000n, "IDR") });

    expect(second.id).not.toBe(first.id);
    expect(second.amount).toEqual(money(2_000_000n, "IDR"));
  });

  test("an open link refuses an amount in the wrong currency", async () => {
    const { catalog, commerce } = harness();
    const link = await catalog.createLink({ kind: "open", merchant, currency: "IDR" });

    await expect(
      commerce.checkoutLink(link.id, { amount: money(100n, "MYR") }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("an open link refuses to mint without an amount", async () => {
    const { catalog, commerce } = harness();
    const link = await catalog.createLink({ kind: "open", merchant, currency: "IDR" });
    await expect(commerce.checkoutLink(link.id)).rejects.toBeInstanceOf(ValidationError);
  });

  test("a catalog link prices from the products at checkout", async () => {
    const { catalog, commerce } = harness();
    const product = await coffee(catalog);
    const link = await catalog.createLink({
      kind: "catalog",
      merchant,
      currency: "IDR",
      lines: [{ productId: product.id, quantity: 3 }],
    });

    const intent = await commerce.checkoutLink(link.id);
    expect(intent.amount).toEqual(money(7_500_000n, "IDR"));
  });

  test("an expired link cannot be paid", async () => {
    const { catalog, clock, commerce } = harness();
    const link = await catalog.createLink({
      kind: "open",
      merchant,
      currency: "IDR",
      expiresAt: new Date(new Date(NOW).getTime() + 60_000),
    });

    clock.set(new Date(new Date(NOW).getTime() + 60_000));
    await expect(
      commerce.checkoutLink(link.id, { amount: money(1_000_000n, "IDR") }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  test("a disabled link cannot be paid", async () => {
    const { catalog, commerce } = harness();
    const link = await catalog.createLink({ kind: "open", merchant, currency: "IDR" });
    await catalog.disableLink(link.id);

    await expect(
      commerce.checkoutLink(link.id, { amount: money(1_000_000n, "IDR") }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  test("the link's merchant reference rides onto every intent it mints", async () => {
    const { catalog, commerce } = harness();
    const link = await catalog.createLink({
      kind: "fixed",
      merchant,
      amount: money(5_000_000n, "IDR"),
      merchantReference: "SUB-9",
    });

    const intent = await commerce.checkoutLink(link.id);
    expect(intent.merchantReference).toBe("SUB-9");
  });

  test("an unknown link is a NotFoundError", async () => {
    const { commerce } = harness();
    await expect(commerce.checkoutLink("lnk_missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("payment link idempotency", () => {
  test("replaying a key returns the original link", async () => {
    const { catalog } = harness();
    const command = {
      kind: "open" as const,
      merchant,
      currency: "IDR" as const,
      idempotencyKey: "link-key-0001",
    };

    const first = await catalog.createLink(command);
    const second = await catalog.createLink(command);
    expect(second.id).toBe(first.id);
  });

  test("reusing a key for a different link is refused", async () => {
    const { catalog } = harness();
    await catalog.createLink({
      kind: "open",
      merchant,
      currency: "IDR",
      idempotencyKey: "link-key-0002",
    });

    await expect(
      catalog.createLink({
        kind: "fixed",
        merchant,
        amount: money(1_000_000n, "IDR"),
        idempotencyKey: "link-key-0002",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
