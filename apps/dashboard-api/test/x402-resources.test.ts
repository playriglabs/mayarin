import { describe, expect, test } from "bun:test";
import type { Merchant } from "@mayarin/auth";
import { InMemoryMerchantRepository } from "@mayarin/auth/testing";
import type { MerchantWallet } from "@mayarin/wallet";
import { InMemoryMerchantWalletRepository } from "@mayarin/wallet/testing";
import type { AssetCapability } from "@mayarin/x402";
import { AssetCapabilities } from "@mayarin/x402";
import { exampleResource, InMemoryResourceRepository } from "@mayarin/x402/testing";
import type { Scope } from "../src/dto/auth.ts";
import { X402ResourceService } from "../src/services/x402-resource-service.ts";

const MERCHANT_ID = "mrc_owner";
const SCOPE = { merchantId: MERCHANT_ID } as Scope;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const BASE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const OWN_WALLET = "0x596a7fb9857ca6c008dae1ba8e0e44c0eb38c1f5";
const OPERATOR = "0x616e2B9Bc83D60790E70CbaAc6c8612AFc6A7896";
const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

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
  operator?: string;
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
    crossAssetOperator: async () => options.operator,
    tokens: {
      "arc-testnet": { USDC: ARC_USDC, EURC: ARC_EURC },
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

    // EURC is configured on Arc, and without an operator this deployment cannot
    // swap it, so offering it would be a rail no payer could pay.
    expect(rails).toEqual([
      {
        chain: "arc-testnet",
        asset: "USDC",
        contract: ARC_USDC,
        payTo: OWN_WALLET,
        kind: "same-asset",
      },
    ]);
  });

  // The agent holds EURC and the merchant still settles USDC, so the rail pays
  // the operator — the one address in this form that is deliberately not the
  // merchant's.
  test("offers a cross-asset rail once the deployment can swap", async () => {
    const { service } = await serviceWith({ operator: OPERATOR });

    const rails = await service.rails(SCOPE);

    expect(rails).toContainEqual({
      chain: "arc-testnet",
      asset: "EURC",
      contract: ARC_EURC,
      payTo: OPERATOR,
      kind: "cross-asset",
    });
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

describe("list", () => {
  test("paginates the merchant's endpoints newest-first without duplicates", async () => {
    const { service, resources } = await serviceWith({});
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        resources.save(
          exampleResource({
            id: `resource-${index}`,
            merchantId: MERCHANT_ID,
            url: `https://merchant.example/resource/${index}`,
          }),
        ),
      ),
    );

    const first = await service.list(SCOPE);
    expect(first.items).toHaveLength(7);
    expect(first.items[0]?.id).toBe("resource-7");
    expect(typeof first.nextCursor).toBe("string");
    if (first.nextCursor === null) throw new Error("Expected another resource page");

    const second = await service.list(SCOPE, { cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).toBe("resource-0");
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((resource) => resource.id)).size).toBe(8);
  });
});

describe("remove", () => {
  test("forgets the merchant's own endpoint", async () => {
    const { service, resources } = await serviceWith({});
    await service.create(SCOPE, { ...input, rails: [{ chain: "arc-testnet", asset: "USDC" }] });

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
      listed: false,
      accepts: [],
    });

    await expect(service.remove(SCOPE, "theirs")).rejects.toThrow(/not found/);
    expect(await resources.findById("theirs")).toBeDefined();
  });
});

describe("create", () => {
  test("fills payTo from the merchant's own wallet and the domain from the token", async () => {
    const { service, resources } = await serviceWith({});

    const resource = await service.create(SCOPE, {
      ...input,
      rails: [{ chain: "arc-testnet", asset: "USDC" }],
    });

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

    await expect(
      service.create(SCOPE, { ...input, rails: [{ chain: "base-sepolia", asset: "USDC" }] }),
    ).rejects.toThrow(/verify a wallet there/);
  });

  test("refuses an id already registered by another merchant", async () => {
    const { service, resources } = await serviceWith({});
    await resources.save({
      id: "fx-quote",
      merchantId: "mrc_someone_else",
      url: "https://elsewhere.example/quote",
      price: { amount: 10_000n, asset: "USD" },
      maxTimeoutSeconds: 60,
      listed: false,
      accepts: [],
    });

    await expect(
      service.create(SCOPE, { ...input, rails: [{ chain: "arc-testnet", asset: "USDC" }] }),
    ).rejects.toThrow(/is taken/);
  });

  test("refuses a resource offering no rail at all", async () => {
    const { service } = await serviceWith({});

    await expect(service.create(SCOPE, { ...input, rails: [] })).rejects.toThrow(
      /at least one rail/,
    );
  });
});

describe("update", () => {
  test("changes the price and the rails, and keeps the id", async () => {
    const { service, resources } = await serviceWith({});
    await service.create(SCOPE, { ...input, rails: [{ chain: "arc-testnet", asset: "USDC" }] });

    const updated = await service.update(SCOPE, "fx-quote", {
      url: "https://merchant.example/quote-v2",
      description: "Two oracle-guarded FX quotes",
      price: { amount: 50_000n, asset: "USD" },
      maxTimeoutSeconds: 120,
      rails: [{ chain: "arc-testnet", asset: "USDC" }],
    });

    expect(updated.id).toBe("fx-quote");
    expect(updated.url).toBe("https://merchant.example/quote-v2");
    expect(updated.price).toEqual({ amount: 50_000n, asset: "USD" });
    expect(await resources.findById("fx-quote")).toMatchObject({ maxTimeoutSeconds: 120 });
  });

  // `save()` upserts every column, so an edit that did not default `listed`
  // to the stored value would silently unlist a resource on every unrelated
  // dashboard change (#273).
  test("an edit that omits listed keeps the resource in the public index", async () => {
    const { service, resources } = await serviceWith({});
    await resources.save({
      id: "fx-quote",
      merchantId: SCOPE.merchantId,
      url: "https://merchant.example/quote",
      price: { amount: 10_000n, asset: "USD" },
      maxTimeoutSeconds: 60,
      listed: true,
      accepts: [],
    });

    const updated = await service.update(SCOPE, "fx-quote", {
      url: "https://merchant.example/quote",
      price: { amount: 20_000n, asset: "USD" },
      maxTimeoutSeconds: 60,
      rails: [{ chain: "arc-testnet", asset: "USDC" }],
    });

    expect(updated.listed).toBe(true);
    expect(await resources.findById("fx-quote")).toMatchObject({ listed: true });
  });

  // A rail's payTo and transfer method come from the wallet and the token, so
  // carrying the old ones forward would keep paying an address the merchant may
  // since have replaced.
  test("rebuilds the rails from what the merchant can offer now", async () => {
    const { service } = await serviceWith({});
    await service.create(SCOPE, { ...input, rails: [{ chain: "arc-testnet", asset: "USDC" }] });

    await expect(
      service.update(SCOPE, "fx-quote", {
        url: input.url,
        price: input.price,
        maxTimeoutSeconds: input.maxTimeoutSeconds,
        rails: [{ chain: "base-sepolia", asset: "USDC" }],
      }),
    ).rejects.toThrow(/verify a wallet there/);
  });

  test("cannot edit another merchant's endpoint, and is not told it exists", async () => {
    const { service, resources } = await serviceWith({});
    await resources.save({
      id: "theirs",
      merchantId: "mrc_someone_else",
      url: "https://elsewhere.example/quote",
      price: { amount: 10_000n, asset: "USD" },
      maxTimeoutSeconds: 60,
      listed: false,
      accepts: [],
    });

    await expect(
      service.update(SCOPE, "theirs", {
        url: "https://mine.example/quote",
        price: { amount: 1n, asset: "USD" },
        maxTimeoutSeconds: 60,
        rails: [{ chain: "arc-testnet", asset: "USDC" }],
      }),
    ).rejects.toThrow(/not found/);
    expect(await resources.findById("theirs")).toMatchObject({ merchantId: "mrc_someone_else" });
  });

  test("an endpoint that does not exist is not created by editing it", async () => {
    const { service, resources } = await serviceWith({});

    await expect(
      service.update(SCOPE, "never-registered", {
        url: "https://merchant.example/quote",
        price: { amount: 1n, asset: "USD" },
        maxTimeoutSeconds: 60,
        rails: [{ chain: "arc-testnet", asset: "USDC" }],
      }),
    ).rejects.toThrow(/not found/);
    expect(await resources.findById("never-registered")).toBeUndefined();
  });

  test("registering over an id the merchant already owns is refused", async () => {
    // Creation used to overwrite it silently. With editing available that is a
    // way to lose an endpoint's rails to a form the merchant thought was blank.
    const { service } = await serviceWith({});
    await service.create(SCOPE, { ...input, rails: [{ chain: "arc-testnet", asset: "USDC" }] });

    await expect(
      service.create(SCOPE, { ...input, rails: [{ chain: "arc-testnet", asset: "USDC" }] }),
    ).rejects.toThrow(/is taken/);
  });
});
