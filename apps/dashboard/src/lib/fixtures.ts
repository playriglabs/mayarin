/**
 * Fixture data for the surfaces that have no endpoint yet.
 *
 * Catalog and settlement are drawn against these. Payments and
 * accounts are NOT — those read the real dashboard API. Everything here is
 * shaped the way the eventual DTO is expected to be shaped, so wiring a real
 * endpoint later replaces the import and not the component.
 *
 * Money is minor units as a `bigint`, exactly as it is everywhere else in this
 * codebase. Nothing here is a float.
 *
 * Timestamps are fixed ISO strings rather than offsets from `Date.now()`, so a
 * screenshot taken today matches one taken next week.
 */

import type { AssetCode } from "@mayarin/shared/asset";

/* -------------------------------------------------------------------------- */
/* Catalog                                                                     */
/* -------------------------------------------------------------------------- */

export type ProductStatus = "active" | "draft" | "archived";

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly sku: string;
  /** Minor units of `currency`. */
  readonly price: bigint;
  readonly currency: AssetCode;
  readonly status: ProductStatus;
  readonly updatedAt: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "prod_01",
    name: "Kopi Susu Gula Aren",
    sku: "BEV-001",
    price: 2_500_000n,
    currency: "IDR",
    status: "active",
    updatedAt: "2026-08-05T09:12:00.000Z",
  },
  {
    id: "prod_02",
    name: "Es Kopi Americano",
    sku: "BEV-002",
    price: 2_200_000n,
    currency: "IDR",
    status: "active",
    updatedAt: "2026-08-05T09:14:00.000Z",
  },
  {
    id: "prod_03",
    name: "Croissant Almond",
    sku: "PST-011",
    price: 3_800_000n,
    currency: "IDR",
    status: "active",
    updatedAt: "2026-08-04T16:40:00.000Z",
  },
  {
    id: "prod_04",
    name: "Cold Brew 1L Bottle",
    sku: "BEV-020",
    price: 9_500_000n,
    currency: "IDR",
    status: "draft",
    updatedAt: "2026-08-06T11:02:00.000Z",
  },
  {
    id: "prod_05",
    name: "Tote Bag Kanvas",
    sku: "MRC-003",
    price: 12_000_000n,
    currency: "IDR",
    status: "archived",
    updatedAt: "2026-07-28T08:20:00.000Z",
  },
];

/* -------------------------------------------------------------------------- */
/* Settlement                                                                  */
/* -------------------------------------------------------------------------- */

export type SettlementStatus = "settled" | "in_flight" | "failed";

export interface Settlement {
  readonly id: string;
  readonly paymentId: string;
  readonly status: SettlementStatus;
  /** Minor units of `asset`. */
  readonly net: bigint;
  readonly fee: bigint;
  readonly asset: AssetCode;
  readonly chain: string;
  readonly txHash: string | null;
  readonly settledAt: string | null;
  readonly createdAt: string;
}

export const SETTLEMENT_ADDRESS = "0x8f2A55949038A9610F50Fb23b5883Af3B4ecb3c3";
export const SETTLEMENT_ASSET: AssetCode = "USDC";
export const SETTLEMENT_CHAIN = "Base Sepolia";

export const SETTLEMENTS: readonly Settlement[] = [
  {
    id: "stl_01",
    paymentId: "pi_3QhK2xLm9vTnBc4d",
    status: "settled",
    net: 14_820_000n,
    fee: 148_000n,
    asset: "USDC",
    chain: "Base Sepolia",
    txHash: "0x9a1f3c7e2b4d8f60a5c1e7b93d2f48a6c0b5e19d7f3a2c684be015d9c37f24a8",
    settledAt: "2026-08-07T10:41:00.000Z",
    createdAt: "2026-08-07T10:39:00.000Z",
  },
  {
    id: "stl_02",
    paymentId: "pi_7RmP4yNq2wUvDf8g",
    status: "settled",
    net: 6_230_000n,
    fee: 62_000n,
    asset: "USDC",
    chain: "Base Sepolia",
    txHash: "0x4e8b2d6a1f9c3057e2b8d4a6c1e0397b5d2e8a4c7f1b3960d5a2e8c4b7f0139a",
    settledAt: "2026-08-07T09:15:00.000Z",
    createdAt: "2026-08-07T09:13:00.000Z",
  },
  {
    id: "stl_03",
    paymentId: "pi_2WdF8kJs5xYzHb1n",
    status: "in_flight",
    net: 21_400_000n,
    fee: 214_000n,
    asset: "USDC",
    chain: "Base Sepolia",
    txHash: null,
    settledAt: null,
    createdAt: "2026-08-08T02:05:00.000Z",
  },
  {
    id: "stl_04",
    paymentId: "pi_5TgQ1zRv7bXcJm3p",
    status: "failed",
    net: 3_100_000n,
    fee: 31_000n,
    asset: "USDC",
    chain: "Base Sepolia",
    txHash: null,
    settledAt: null,
    createdAt: "2026-08-06T18:52:00.000Z",
  },
];
