/**
 * OG card + meta builders (#165). The PNG render path (satori + resvg) is
 * exercised by the route test; this file pins the pure text the card and the
 * `<meta>` tags carry, with no font loaded.
 */

import { describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import {
  defaultOgMeta,
  genericCard,
  invoiceCard,
  linkCard,
  ogDescription,
  ogMetaTags,
} from "../src/services/og-image.ts";

describe("linkCard", () => {
  test("a fixed link shows the human-form total and asset", () => {
    const card = linkCard({
      merchantName: "Kopi Kita",
      title: undefined,
      total: money(5_043_200n, "IDR"),
    });
    expect(card.headline).toBe("Rp 50.432");
    expect(card.subline).toBe("IDR");
    expect(card.stateLabel).toBeUndefined();
  });

  test("a stablecoin total trims trailing zeros past two decimals", () => {
    const card = linkCard({
      merchantName: "M",
      title: undefined,
      total: money(12_500_000n, "USDC"),
    });
    // USDC is 6 decimals: 12.500000 → "12,50" in id-ID (two-decimal floor), asset
    // code suffix when no symbol.
    expect(card.headline).toBe("12,50 USDC");
    expect(card.subline).toBe("USDC");
  });

  test("an open link with no amount shows its title", () => {
    const card = linkCard({ merchantName: "Kopi Kita", title: "Buy a coffee", total: undefined });
    expect(card.headline).toBe("Buy a coffee");
    expect(card.subline).toBe("Enter an amount to pay");
  });

  test("an open link without a title falls back to Pay {merchant}", () => {
    const card = linkCard({ merchantName: "Kopi Kita", title: undefined, total: undefined });
    expect(card.headline).toBe("Pay Kopi Kita");
  });
});

describe("invoiceCard", () => {
  test("an issued invoice with an outstanding balance shows it", () => {
    const card = invoiceCard({
      merchantName: "Kopi Kita",
      number: "INV-001",
      status: "issued",
      outstanding: money(1_000_000n, "IDR"),
      total: money(1_000_000n, "IDR"),
    });
    expect(card.headline).toBe("Rp 10.000");
    expect(card.subline).toBe("Invoice INV-001 · outstanding in IDR");
    expect(card.stateLabel).toBeUndefined();
  });

  test("a settled invoice is labelled Settled and shows the total", () => {
    const card = invoiceCard({
      merchantName: "Kopi Kita",
      number: "INV-001",
      status: "issued",
      outstanding: money(0n, "IDR"),
      total: money(1_000_000n, "IDR"),
    });
    expect(card.stateLabel).toBe("Settled");
    expect(card.subline).toBe("Invoice INV-001 · settled");
  });

  test("a voided invoice is labelled Voided", () => {
    const card = invoiceCard({
      merchantName: "Kopi Kita",
      number: "INV-001",
      status: "void",
      outstanding: money(1_000_000n, "IDR"),
      total: money(1_000_000n, "IDR"),
    });
    expect(card.stateLabel).toBe("Voided");
    expect(card.subline).toBe("Voided");
  });

  test("an unnumbered invoice says Invoice, not Invoice undefined", () => {
    const card = invoiceCard({
      merchantName: "Kopi Kita",
      number: undefined,
      status: "issued",
      outstanding: money(1_000_000n, "IDR"),
      total: money(1_000_000n, "IDR"),
    });
    expect(card.subline).toBe("Invoice · outstanding in IDR");
  });
});

describe("ogDescription", () => {
  test("is the subline when there is no state label", () => {
    expect(ogDescription({ merchantName: "M", headline: "x", subline: "IDR" })).toBe("IDR");
  });

  test("prefixes the state label for a settled/voided card", () => {
    expect(
      ogDescription({
        merchantName: "M",
        headline: "x",
        subline: "Invoice 1 · settled",
        stateLabel: "Settled",
      }),
    ).toBe("Settled · Invoice 1 · settled");
  });
});

describe("ogMetaTags", () => {
  const tags = ogMetaTags({
    title: 'Pay "Kopi" & Co',
    description: "Rp 50.432",
    imageUrl: "https://pay-testnet.mayarin.xyz/checkout/abc/og.png",
    imageAlt: "Pay Kopi",
  });

  test("emits og + twitter cards pointing at the image url", () => {
    expect(tags).toContain(
      'og:image" content="https://pay-testnet.mayarin.xyz/checkout/abc/og.png"',
    );
    expect(tags).toContain('twitter:card" content="summary_large_image"');
    expect(tags).toContain(
      'twitter:image" content="https://pay-testnet.mayarin.xyz/checkout/abc/og.png"',
    );
  });

  test("escapes quotes and ampersands in attribute values", () => {
    expect(tags).toContain('og:title" content="Pay &quot;Kopi&quot; &amp; Co"');
  });

  test("defaultOgMeta points at the generic landing image", () => {
    expect(defaultOgMeta()).toContain('og:image" content="https://mayarin.xyz/og-image.png"');
  });
});

describe("genericCard", () => {
  test("names Mayarin Pay", () => {
    expect(genericCard().merchantName).toBe("Mayarin Pay");
  });
});
