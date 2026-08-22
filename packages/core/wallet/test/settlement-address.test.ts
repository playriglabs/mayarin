/**
 * Settlement address resolution tests (#11, #95).
 *
 * The failure being ruled out is quiet: a merchant is provisioned a Safe, never
 * touches the settings form nobody told them about, and their first payment
 * refuses to lock. Nothing looks broken until money is meant to arrive.
 */

import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "@mayarin/shared";
import { type MerchantWallet, SettlementAddressResolver } from "../src/index.ts";
import { InMemoryMerchantWalletRepository } from "../testing/index.ts";

const MERCHANT = "mrc_1";
const CHAIN = "base-sepolia" as const;
const MANAGED = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-01-01T00:00:00.000Z");

function managed(overrides: Partial<MerchantWallet> = {}): MerchantWallet {
  return {
    id: "wlt_managed",
    merchantId: MERCHANT,
    chain: CHAIN,
    address: MANAGED,
    provenance: "provisioned",
    verifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup() {
  const wallets = new InMemoryMerchantWalletRepository();
  return { wallets, resolver: new SettlementAddressResolver({ wallets }) };
}

describe("resolve", () => {
  test("falls back to the managed wallet when the merchant set nothing", async () => {
    const { wallets, resolver } = setup();
    await wallets.insert(managed());

    expect(await resolver.resolve(MERCHANT, CHAIN, undefined)).toEqual({
      source: "managed",
      address: MANAGED,
    });
  });

  test("what the merchant set wins over what they were given", async () => {
    // An explicit choice is a choice. A merchant may hold a managed Safe and
    // still want paying somewhere else; the source is retained so the guard can
    // apply the configured-destination rules.
    const { wallets, resolver } = setup();
    await wallets.insert(managed());
    const chosen = "0x3333333333333333333333333333333333333333";

    expect(await resolver.resolve(MERCHANT, CHAIN, chosen)).toEqual({
      source: "configured",
      address: chosen,
    });
  });

  test("lowercases what the merchant set", async () => {
    // The registry stores addresses lowercased and the guard compares them that
    // way. A mixed-case configured value would be refused as unknown.
    const { resolver } = setup();

    expect(
      await resolver.resolve(MERCHANT, CHAIN, "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    ).toEqual({
      source: "configured",
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  test("does not fall back to a half-provisioned wallet", async () => {
    // The row is written before the Safe is deployed. Paying into a predicted
    // address with no Safe at it sends the money nowhere recoverable.
    const { wallets, resolver } = setup();
    const { verifiedAt: _pending, ...pending } = managed();
    await wallets.insert(pending);

    await expect(resolver.resolve(MERCHANT, CHAIN, undefined)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("does not fall back across chains", async () => {
    // A managed wallet is per chain. Answering with chain A's Safe for a payment
    // on chain B names an address that may not be deployed there at all.
    const { wallets, resolver } = setup();
    await wallets.insert(managed());

    await expect(resolver.resolve(MERCHANT, "base", undefined)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("does not fall back to another merchant's wallet", async () => {
    const { wallets, resolver } = setup();
    await wallets.insert(managed({ merchantId: "mrc_2" }));

    await expect(resolver.resolve(MERCHANT, CHAIN, undefined)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("effective gives the same answer without the throw", async () => {
    // The settings screen has to answer "and if I leave this blank?" with the
    // rule the signer applies. Two computations of one fallback is how the
    // screen and the signer end up disagreeing.
    const { wallets, resolver } = setup();
    await wallets.insert(managed());

    expect(await resolver.effective(MERCHANT, CHAIN, undefined)).toBe(
      (await resolver.resolve(MERCHANT, CHAIN, undefined)).address,
    );
  });

  test("effective is undefined where resolve throws", async () => {
    const { resolver } = setup();

    expect(await resolver.effective(MERCHANT, CHAIN, undefined)).toBeUndefined();
  });

  test("refuses when there is nothing to fall back to", async () => {
    // The alternative would be a deployment-wide address, which pays every
    // merchant into the same wallet with no way to tell the payments apart.
    const { resolver } = setup();

    await expect(resolver.resolve(MERCHANT, CHAIN, undefined)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });
});
