import { describe, expect, test } from "bun:test";
import type { Merchant } from "@mayarin/auth";
import { InMemoryMerchantRepository } from "@mayarin/auth/testing";
import type { MerchantWallet } from "@mayarin/wallet";
import { InMemoryMerchantWalletRepository } from "@mayarin/wallet/testing";
import type { AssetCapability } from "@mayarin/x402";
import { AssetCapabilities } from "@mayarin/x402";
import { InMemoryResourceRepository } from "@mayarin/x402/testing";
import type { Scope } from "../src/dto/auth.ts";
import { X402ResourceService } from "../src/services/x402-resource-service.ts";

const MERCHANT_ID = "mrc_owner";
const SCOPE = { merchantId: MERCHANT_ID } as Scope;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const BASE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const OWN_WALLET = "0x596a7fb9857ca6c008dae1ba8e0e44c0eb38c1f5";

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: MERCHANT_ID,
    name: "Mayarin Infra",
    settlementAsset: "USDC",
    acceptedAssets: ["USDC"],
    version: 1,
    createdAt: new Date("2026-09-06T00:00:00Z"),
    updatedAt: new Date("2026-09-06T00:00:00Z"),
    ...overrides,
  } as Merchant;
}

function wallet(overrides: Record<string, unknown> = {}): MerchantWallet {
  return {
    id: "wlt_1",
    merchantId: MERCHANT_ID,
    chain: "arc-testnet",
    address: OWN_WALLET,
    provenance: "linked",
    verifiedAt: new Date("2026-09-05T00:00:00Z"),
    createdAt: new Date("2026-09-05T00:00:00Z"),
    ...overrides,
  } as MerchantWallet;
}

async function serviceWith(options: {
  merchant?: Merchant;
  wallets?: readonly MerchantWallet[];
  probed?: number[];
}) {
  const merchants = new InMemoryMerchantRepository();
  await merchants.insert(options.merchant ?? merchant());
  const wallets = new InMemoryMerchantWalletRepository();
  for (const each of options.wallets ?? [wallet()]) await wallets.insert(each);

  const probes = ["arc-testnet", "base-sepolia"].map((chain) => ({
    chain: chain as "arc-testnet",
    async probe(contract: string): Promise<AssetCapability> {
      return {
        chain: chain as "arc-testnet",
        contract,
        transferMethod: "eip3009",
        domain: { name: "USDC", version: "2" },
        supportsPermit: true,
      };
    },
  }));

  const resources = new InMemoryResourceRepository();
  const service = new X402ResourceService({
    resources,
    merchants,
    wallets,
    capabilities: new AssetCapabilities({ pairs: [], probes }),
    tokens: {
      "arc-testnet": { USDC: ARC_USDC, EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" },
      "base-sepolia": { USDC: BASE_USDC },
    },
  });
  return { service, resources };
}

const input = {
  id: "fx-quote",
  url: "https://merchant.example/quote",
  price: { amount: 20_000n, asset: "USD" as const },
  maxTimeoutSeconds: 60,
};

describe("rails", () => {
  test("offers only the merchant's settlement asset, at their own address", async () => {
    const { service } = await serviceWith({});

    const rails = await service.rails(SCOPE);

    // EURC is configured on Arc and is not offered: this merchant settles in
    // USDC, and a EURC rail would pay the operator rather than them.
    expect(rails).toEqual([
      { chain: "arc-testnet", asset: "USDC", contract: ARC_USDC, payTo: OWN_WALLET },
    ]);
  });

  test("offers nothing on a chain where the wallet is unverified", async () => {
    const { service } = await serviceWith({
      wallets: [wallet({ verifiedAt: undefined })],
    });

    expect(await service.rails(SCOPE)).toEqual([]);
  });

  test("a configured settlement address serves every chain", async () => {
    const { service } = await serviceWith({
      merchant: merchant({ settlementAddress: OWN_WALLET }),
      wallets: [],
    });

    expect((await service.rails(SCOPE)).map((rail) => rail.chain)).toEqual([
      "arc-testnet",
      "base-sepolia",
    ]);
  });
});

describe("remove", () => {
  test("forgets the merchant's own endpoint", async () => {
    const { service, resources } = await serviceWith({});
    await service.create(SCOPE, { ...input, chains: ["arc-testnet"] });

    await service.remove(SCOPE, "fx-quote");

    expect(await resources.findById("fx-quote")).toBeUndefined();
  });

  // Another merchant's id reads as absent rather than forbidden: the caller
  // learns nothing about what exists outside their own account.
  test("cannot remove another merchant's endpoint, and is not told it exists", async () => {
    const { service, resources } = await serviceWith({});
    await resources.save({
      id: "theirs",
      merchantId: "mrc_someone_else",
      url: "https://elsewhere.example/quote",
      price: { amount: 10_000n, asset: "USD" },
      maxTimeoutSeconds: 60,
      accepts: [],
    });

    await expect(service.remove(SCOPE, "theirs")).rejects.toThrow(/not found/);
    expect(await resources.findById("theirs")).toBeDefined();
  });
});

describe("create", () => {
  test("fills payTo from the merchant's own wallet and the domain from the token", async () => {
    const { service, resources } = await serviceWith({});

    const resource = await service.create(SCOPE, { ...input, chains: ["arc-testnet"] });

    expect(resource.accepts).toEqual([
      {
        chain: "arc-testnet",
        asset: "USDC",
        contract: ARC_USDC,
        payTo: OWN_WALLET,
        domain: { name: "USDC", version: "2" },
        transferMethod: "eip3009",
      },
    ]);
    expect(await resources.findById("fx-quote")).toMatchObject({ merchantId: MERCHANT_ID });
  });

  // The reason registration was admin-only: a rail pointed at an address the
  // merchant cannot prove they hold sends every payment on it into the dark.
  test("refuses a chain the merchant cannot be paid on", async () => {
    const { service } = await serviceWith({});

    await expect(service.create(SCOPE, { ...input, chains: ["base-sepolia"] })).rejects.toThrow(
      /link and verify a wallet/,
    );
  });

  test("refuses an id already registered by another merchant", async () => {
    const { service, resources } = await serviceWith({});
    await resources.save({
      id: "fx-quote",
      merchantId: "mrc_someone_else",
      url: "https://elsewhere.example/quote",
      price: { amount: 10_000n, asset: "USD" },
      maxTimeoutSeconds: 60,
      accepts: [],
    });

    await expect(service.create(SCOPE, { ...input, chains: ["arc-testnet"] })).rejects.toThrow(
      /is taken/,
    );
  });

  test("refuses a resource offering no rail at all", async () => {
    const { service } = await serviceWith({});

    await expect(service.create(SCOPE, { ...input, chains: [] })).rejects.toThrow(
      /at least one chain/,
    );
  });
});
