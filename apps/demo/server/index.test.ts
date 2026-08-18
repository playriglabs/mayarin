import { describe, expect, test } from "bun:test";
import type { PaymentLinkDto } from "@mayarin/api/dto";
import { findReusableCatalogLink } from "./index.ts";

function link(overrides: Partial<PaymentLinkDto> & Pick<PaymentLinkDto, "id">): PaymentLinkDto {
  const { id, ...rest } = overrides;
  return {
    id,
    kind: "catalog",
    merchant: { id: "mrc_1", name: "Toko", city: "Jakarta", countryCode: "ID" },
    amount: null,
    currency: "IDR",
    lines: [{ productId: "prod_1", quantity: 1 }],
    title: null,
    merchantReference: null,
    metadata: {},
    url: `https://pay.test/checkout/${id}`,
    payable: true,
    expiresAt: null,
    disabledAt: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    version: 1,
    ...rest,
  };
}

describe("findReusableCatalogLink", () => {
  test("reuses a payable link for the same product and quantity", () => {
    const reusable = link({ id: "link_reusable" });

    expect(
      findReusableCatalogLink([reusable], { lines: [{ productId: "prod_1", quantity: 1 }] }),
    ).toBe(reusable);
  });

  test("ignores disabled links and links for another product", () => {
    const disabled = link({ id: "link_disabled", payable: false });
    const otherProduct = link({
      id: "link_other",
      lines: [{ productId: "prod_2", quantity: 1 }],
    });

    expect(
      findReusableCatalogLink([disabled, otherProduct], {
        lines: [{ productId: "prod_1", quantity: 1 }],
      }),
    ).toBeUndefined();
  });

  test("reuses a multi-product link regardless of cart order", () => {
    const reusable = link({
      id: "link_cart",
      lines: [
        { productId: "prod_1", quantity: 2 },
        { productId: "prod_2", quantity: 1 },
      ],
    });

    expect(
      findReusableCatalogLink([reusable], {
        lines: [
          { productId: "prod_2", quantity: 1 },
          { productId: "prod_1", quantity: 2 },
        ],
      }),
    ).toBe(reusable);
  });

  test("does not reuse a link with a stale merchant snapshot", () => {
    const stale = link({ id: "link_stale" });

    expect(
      findReusableCatalogLink(
        [stale],
        { lines: [{ productId: "prod_1", quantity: 1 }] },
        undefined,
        { id: "mrc_1", name: "Parahyangan Supply", city: "Bandung", countryCode: "ID" },
      ),
    ).toBeUndefined();
  });
});
