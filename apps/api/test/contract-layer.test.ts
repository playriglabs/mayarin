import { describe, expect, test } from "bun:test";
import { BasisPointsFeePolicy } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { priceSourceOf } from "@mayarin/execution";
import { FixedSwapVenue } from "@mayarin/execution/testing";
import { ESCROW_FACTORY_V2, escrowAddress } from "@mayarin/provider-evm";
import { LocalSolanaOrderSigner } from "@mayarin/provider-solana";
import { QuoteEngine } from "@mayarin/quote";
import { FakeOrderSigner } from "@mayarin/quote/testing";
import { ConfigurationError, FixedClock, money, ValidationError } from "@mayarin/shared";
import { InMemoryStablecoinRegistry } from "@mayarin/stablecoin";
import { type MerchantWallet, SettlementAddressResolver, WalletGuard } from "@mayarin/wallet";
import { InMemoryMerchantWalletRepository } from "@mayarin/wallet/testing";
import { getAddress } from "viem";
import { ApiContractPlanner } from "../src/contract-layer.ts";
import type { QuoteLayer } from "../src/quote-layer.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const ROUTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
const MERCHANT_SAFE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYER = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";
const USDC_TOKEN = "0x00000000000000000000000000000000000001d1";

/** 60,000,000.00 USDC per whole ETH. */
const ETH_USDC_RATE = 6_000_000_000n;
/** 13.79 USDC per whole SOL. */
const SOL_USDC_RATE = 13_790_000n;

// `null` means the merchant has no settlement address; `undefined` would be
// swallowed by the default parameter and silently pass the address through.
function createPlanner(
  settlementAddress: string | null = MERCHANT_SAFE,
  wallets?: WalletGuard,
  settlementAddresses?: SettlementAddressResolver,
  relayerGasFeeBasisPoints = 10,
  feeMinimum = "0",
  escrowArbiter?: string,
  solana?: {
    readonly router: string;
    readonly mint: string;
    readonly domain: Uint8Array;
    readonly signer: LocalSolanaOrderSigner;
  },
) {
  const clock = new FixedClock(NOW);
  const venue = new FixedSwapVenue("0x", [
    { from: "ETH", to: "USDC", scaledRate: ETH_USDC_RATE, source: "0x" },
    { from: "SOL", to: "USDC", scaledRate: SOL_USDC_RATE, source: "orca" },
  ]);
  const oracle = new FixedPriceOracle([
    {
      from: "ETH",
      to: "USDC",
      scaledRate: ETH_USDC_RATE,
      source: "pyth",
      observedAt: NOW,
    },
    {
      from: "SOL",
      to: "USDC",
      scaledRate: SOL_USDC_RATE,
      source: "pyth",
      observedAt: NOW,
    },
  ]);
  const signer = new FakeOrderSigner();
  const engine = new QuoteEngine({
    venue: priceSourceOf(venue),
    oracle,
    policy: { maxDeviationBps: 100, maxAgeMs: 60_000 },
    fiat: {
      pegged: ["USD/USDC"],
      maxAgeMs: 300_000,
      closedMaxAgeMs: 300_000,
      closedSpreadBps: 0,
    },
    clock,
  });
  const quote: QuoteLayer = {
    engine,
    venues: [venue],
    oracle,
    signer,
    slippageBps: 50,
    ttlSeconds: 120,
  };
  const planner = new ApiContractPlanner({
    contract: {
      paymentRouters: {
        base: ROUTER,
        "arbitrum-sepolia": ROUTER,
        ...(solana === undefined ? {} : { "solana-localnet": solana.router }),
      },
    },
    quote: async () => quote,
    fees: new BasisPointsFeePolicy(50, feeMinimum),
    relayerGasFees: new BasisPointsFeePolicy(relayerGasFeeBasisPoints),
    stablecoins: new InMemoryStablecoinRegistry([
      {
        asset: "USDC",
        onChain: [
          { chain: "base", address: USDC_TOKEN },
          { chain: "arbitrum-sepolia", address: USDC_TOKEN },
          ...(solana === undefined
            ? []
            : [{ chain: "solana-localnet" as const, address: solana.mint }]),
        ],
      },
    ]),
    merchantPolicies: {
      policyFor: async () => ({
        settlementAsset: "USDC" as const,
        acceptedAssets: [],
        ...(settlementAddress === null ? {} : { settlementAddress }),
      }),
    },
    ...(wallets === undefined ? {} : { wallets }),
    ...(settlementAddresses === undefined ? {} : { settlementAddresses }),
    ...(escrowArbiter === undefined ? {} : { escrowArbiter }),
    ...(solana === undefined
      ? {}
      : {
          solana: {
            signer: solana.signer,
            deploymentDomains: { "solana-localnet": solana.domain },
          },
        }),
    clock,
  });
  return { planner, venue, signer, clock };
}

function lockRequest(payerAsset: "ETH" | "SOL" | "USDC") {
  return {
    clearingTransactionId: "clr_test_1",
    paymentIntentId: "pi_test_1",
    merchantId: "ID1020017611473",
    sourceAmount: money(500n, "USD"), // $5.00, pegged 1:1 into 5.000000 USDC
    settlementAsset: "USDC",
    payerAsset,
    chain: "base",
    payerAddress: PAYER,
    submission: "payer",
  } as const;
}

describe("ApiContractPlanner", () => {
  test("locks a cross-asset payment: signed order agrees with the lock", async () => {
    const { planner, signer } = createPlanner();

    const lock = await planner.lock(lockRequest("ETH"));

    expect(lock.settlementAmount).toEqual(money(5_000_000n, "USDC"));
    expect(lock.fee).toEqual(money(25_000n, "USDC"));
    expect(lock.order.minOut).toBe(5_000_000n);
    expect(lock.order.fee).toBe(25_000n);
    expect(lock.order.settlementToken.toLowerCase()).toBe(USDC_TOKEN);
    expect(lock.order.merchantSafe).toBe(MERCHANT_SAFE);
    expect(lock.order.refundTo).toBe(PAYER);
    expect(lock.order.signer).toBe(await signer.address());
    expect(lock.expiresAt).toEqual(new Date(NOW.getTime() + 120_000));
    expect(lock.order.deadline).toBe(BigInt(Math.floor(lock.expiresAt.getTime() / 1_000)));

    // The payer estimate is grossed up: never below the raw conversion.
    const raw = (5_000_000n * 10n ** 18n) / ETH_USDC_RATE;
    expect(lock.payerEstimate.asset).toBe("ETH");
    expect(lock.payerEstimate.amount >= raw).toBe(true);

    // The typed data went to the signer with the deployment's domain.
    expect(signer.calls).toHaveLength(1);
    expect(signer.calls[0]?.domain.chainId).toBe(8_453n);
    expect(signer.calls[0]?.domain.verifyingContract).toBe(ROUTER);
    expect(signer.calls[0]?.message.intentId).toBe(lock.order.intentId as `0x${string}`);
  });

  test("adds gas reimbursement only to a relayer-submitted signed fee", async () => {
    const { planner } = createPlanner();

    const payer = await planner.lock(lockRequest("ETH"));
    const relayed = await planner.lock({
      ...lockRequest("ETH"),
      clearingTransactionId: "clr_test_relayed",
      paymentIntentId: "pi_test_relayed",
      submission: "relayer",
    });

    expect(payer.fee).toEqual(money(25_000n, "USDC"));
    expect(relayed.fee).toEqual(money(30_000n, "USDC"));
    expect(relayed.order.fee).toBe(30_000n);
  });

  test("a fee floor lifts the signed fee on a small payment", async () => {
    const { planner } = createPlanner(MERCHANT_SAFE, undefined, undefined, 10, "0.10");

    // 0.5% of $5.00 is 0.025 USDC, below the 0.10 floor.
    const lock = await planner.lock(lockRequest("USDC"));

    expect(lock.fee).toEqual(money(100_000n, "USDC"));
    expect(lock.order.fee).toBe(100_000n);
  });

  test("refuses to sign an order whose fee would take the whole payment", async () => {
    // A 5.00 floor on a $5.00 payment: the router would revert, after the payer paid gas.
    const { planner, signer } = createPlanner(MERCHANT_SAFE, undefined, undefined, 10, "5.00");

    await expect(planner.lock(lockRequest("USDC"))).rejects.toThrow(ValidationError);
    expect(signer.calls).toHaveLength(0);
  });

  test("can keep the signed order executable beyond the quote freshness window", async () => {
    const { planner } = createPlanner();
    const orderExpiresAt = new Date(NOW.getTime() + 960_000);

    const lock = await planner.lock({ ...lockRequest("ETH"), orderExpiresAt });

    expect(lock.expiresAt).toEqual(new Date(NOW.getTime() + 120_000));
    expect(lock.order.deadline).toBe(BigInt(orderExpiresAt.getTime()) / 1_000n);
  });

  test("the intent id derives from the clearing transaction: a re-lock signs the same id", async () => {
    const { planner } = createPlanner();

    const first = await planner.lock(lockRequest("ETH"));
    const second = await planner.lock(lockRequest("ETH"));

    expect(second.order.intentId).toBe(first.order.intentId);
  });

  test("a same-asset payment skips the swap leg entirely", async () => {
    const { planner, venue } = createPlanner();

    const lock = await planner.lock(lockRequest("USDC"));

    expect(venue.calls).toHaveLength(0);
    expect(lock.payerEstimate).toEqual(money(5_000_000n, "USDC"));
    expect(lock.rate.source).toBe("peg");
    expect(lock.order.minOut).toBe(5_000_000n);
  });

  test("signs a domain-separated same-mint Solana payment", async () => {
    const router = "5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f";
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const payer = "So11111111111111111111111111111111111111112";
    const signer = new LocalSolanaOrderSigner(new Uint8Array(32).fill(9));
    const { planner } = createPlanner(router, undefined, undefined, 10, "0", undefined, {
      router,
      mint,
      domain: new Uint8Array(32).fill(3),
      signer,
    });

    const lock = await planner.lock({
      ...lockRequest("USDC"),
      chain: "solana-localnet",
      payerAddress: payer,
    });

    expect(lock.order.settlementToken).toBe(mint);
    expect(lock.order.merchantSafe).toBe(router);
    expect(lock.order.refundTo).toBe(payer);
    expect(lock.order.intentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Buffer.from(lock.order.signature, "base64")).toHaveLength(64);
    expect(lock.order.signer).toBe(signer.publicKey());
  });

  test("locks a cross-asset Solana payment with the Orca payer estimate", async () => {
    const router = "5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f";
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const payer = "So11111111111111111111111111111111111111112";
    const signer = new LocalSolanaOrderSigner(new Uint8Array(32).fill(9));
    const { planner } = createPlanner(router, undefined, undefined, 10, "0", undefined, {
      router,
      mint,
      domain: new Uint8Array(32).fill(3),
      signer,
    });

    const lock = await planner.lock({
      ...lockRequest("SOL"),
      chain: "solana-localnet",
      payerAddress: payer,
    });

    expect(lock.rate).toMatchObject({ from: "SOL", to: "USDC", source: "orca" });
    expect(lock.payerEstimate.asset).toBe("SOL");
    expect(lock.payerEstimate.amount).toBeGreaterThan(362_581_581n);
    expect(lock.payerEstimate).not.toEqual(lock.settlementAmount);
    expect(lock.order.minOut).toBe(5_000_000n);
  });

  test("a chain without a deployed router is refused", async () => {
    const { planner } = createPlanner();

    expect(planner.lock({ ...lockRequest("ETH"), chain: "base-sepolia" })).rejects.toThrow(
      /No PaymentRouter deployed/,
    );
  });

  test("renews with the same economic terms and the deployment's domain", async () => {
    const { planner, signer } = createPlanner();
    const lock = await planner.lock(lockRequest("ETH"));
    const expiresAt = new Date(NOW.getTime() + 86_400_000);

    const renewed = await planner.renew({ chain: "base", order: lock.order, expiresAt });

    // Same terms, fresh window: only the deadline and the signature differ.
    expect(renewed.intentId).toBe(lock.order.intentId);
    expect(renewed.settlementToken).toBe(lock.order.settlementToken);
    expect(renewed.minOut).toBe(lock.order.minOut);
    expect(renewed.fee).toBe(lock.order.fee);
    expect(renewed.merchantSafe).toBe(lock.order.merchantSafe);
    expect(renewed.refundTo).toBe(lock.order.refundTo);
    expect(renewed.deadline).toBe(BigInt(expiresAt.getTime()) / 1_000n);
    expect(renewed.signer).toBe(await signer.address());

    // The typed data went to the signer with the deployment's domain, and the
    // message is the persisted order with only the deadline changed.
    expect(signer.calls).toHaveLength(2);
    expect(signer.calls[1]?.domain.chainId).toBe(8_453n);
    expect(signer.calls[1]?.domain.verifyingContract).toBe(ROUTER);
    const [locked, resigned] = [signer.calls[0]?.message, signer.calls[1]?.message];
    expect(resigned?.deadline).toBe(BigInt(expiresAt.getTime()) / 1_000n);
    expect({ ...resigned, deadline: 0n }).toEqual({ ...locked, deadline: 0n });
  });

  test("renewing on a chain without a deployed router is refused", async () => {
    const { planner } = createPlanner();
    const lock = await planner.lock(lockRequest("ETH"));

    await expect(
      planner.renew({ chain: "base-sepolia", order: lock.order, expiresAt: NOW }),
    ).rejects.toThrow(/No PaymentRouter deployed/);
  });
});

describe("conditional settlement (#304)", () => {
  const ARBITER = "0x000000000000000000000000000000000000a1b1";
  const escrowed = {
    ...lockRequest("USDC"),
    chain: "arbitrum-sepolia",
    escrow: { holdSeconds: 7 * 24 * 60 * 60, arbiter: ARBITER, payer: PAYER },
  } as const;

  test("signs the escrow address as merchantSafe; the merchant becomes its payee", async () => {
    const { planner } = createPlanner();

    const lock = await planner.lock(escrowed);
    const escrow = lock.order.escrow;

    expect(escrow).toEqual({
      // A v2 chain (#315): every new escrow carries a bond, zero when none is set.
      factory: ESCROW_FACTORY_V2,
      payer: PAYER,
      payee: MERCHANT_SAFE,
      arbiter: getAddress(ARBITER),
      releaseAfter: BigInt(NOW.getTime() / 1_000 + 7 * 24 * 60 * 60),
      // The arbiter's window, after which an open dispute refunds the payer.
      resolveBy: BigInt(NOW.getTime() / 1_000 + 14 * 24 * 60 * 60),
      bond: 0n,
    });
    if (escrow === undefined) throw new Error("unreachable");
    expect(lock.order.merchantSafe).toBe(
      escrowAddress({ ...escrow, intentId: lock.order.intentId as `0x${string}` }),
    );
    expect(lock.order.merchantSafe).not.toBe(MERCHANT_SAFE);
    expect(lock.order.refundTo).toBe(PAYER);
  });

  test("fixes the bond at the lock as a share of what reaches the escrow (#315)", async () => {
    const { planner } = createPlanner();

    const lock = await planner.lock({ ...escrowed, escrow: { ...escrowed.escrow, bondBps: 500 } });

    expect(lock.order.escrow?.bond).toBe(((lock.order.minOut - lock.order.fee) * 500n) / 10_000n);
    expect(lock.order.escrow?.bond).toBeGreaterThan(0n);
  });

  test("an ordinary payment carries no escrow", async () => {
    const { planner } = createPlanner();

    const lock = await planner.lock({ ...lockRequest("USDC"), chain: "arbitrum-sepolia" });

    expect(lock.order.escrow).toBeUndefined();
    expect(lock.order.merchantSafe).toBe(MERCHANT_SAFE);
  });

  test("names Mayarin Resolution when the merchant names no arbiter", async () => {
    const RESOLUTION = "0x000000000000000000000000000000000000d15c";
    const { planner } = createPlanner(MERCHANT_SAFE, undefined, undefined, 10, "0", RESOLUTION);
    const { arbiter: _arbiter, ...noArbiter } = escrowed.escrow;

    const lock = await planner.lock({ ...escrowed, escrow: noArbiter });

    expect(lock.order.escrow?.arbiter).toBe(getAddress(RESOLUTION));
  });

  test("refuses an arbiter who is the merchant or the payer", async () => {
    const { planner, signer } = createPlanner();

    for (const arbiter of [MERCHANT_SAFE.toLowerCase(), PAYER]) {
      await expect(
        planner.lock({ ...escrowed, escrow: { ...escrowed.escrow, arbiter } }),
      ).rejects.toThrow(ValidationError);
    }
    expect(signer.calls).toHaveLength(0);
  });

  test("a chain without the escrow factory is refused before signing", async () => {
    const { planner, signer } = createPlanner();

    await expect(planner.lock({ ...escrowed, chain: "base" })).rejects.toThrow(ValidationError);
    expect(signer.calls).toHaveLength(0);
  });
});

describe("merchant settlement address", () => {
  test("refuses to sign an order for a merchant with no settlement address", async () => {
    // No deployment-wide fallback exists on purpose: one would sign every
    // merchant's payments to the same wallet, and `merchantSafe` is inside the
    // EIP-712 digest the contract verifies, so the mistake is unrecoverable.
    const { planner } = createPlanner(null);

    await expect(planner.lock(lockRequest("ETH"))).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe("a merchant who never named their wallet is still paid at it (#11)", () => {
  const NOW_DATE = new Date(NOW);
  const MANAGED_SAFE = "0x1234567890abcdef1234567890abcdef12345678";

  function managedWallet(overrides: Partial<MerchantWallet> = {}): MerchantWallet {
    return {
      id: "wlt_managed",
      merchantId: "ID1020017611473",
      chain: "base",
      address: MANAGED_SAFE,
      provenance: "provisioned",
      verifiedAt: NOW_DATE,
      createdAt: NOW_DATE,
      updatedAt: NOW_DATE,
      ...overrides,
    };
  }

  function planner(settlementAddress: string | null, wallet?: MerchantWallet) {
    const wallets = new InMemoryMerchantWalletRepository();
    const inserted = wallet === undefined ? Promise.resolve() : wallets.insert(wallet);
    return inserted.then(() =>
      createPlanner(
        settlementAddress,
        new WalletGuard({ wallets, treasuryAddresses: [] }),
        new SettlementAddressResolver({ wallets }),
      ),
    );
  }

  test("falls back to the provisioned Safe when no address is set", async () => {
    // Before this, a merchant handed a Safe had to go and name it in a settings
    // form nobody mentioned, and found out it was load-bearing when their first
    // payment refused to lock.
    const { planner: subject } = await planner(null, managedWallet());

    const lock = await subject.lock(lockRequest("ETH"));

    expect(lock.order.merchantSafe.toLowerCase()).toBe(MANAGED_SAFE);
  });

  test("what the merchant set still wins", async () => {
    const { planner: subject } = await planner(
      MERCHANT_SAFE,
      managedWallet({
        id: "wlt_chosen",
        address: MERCHANT_SAFE.toLowerCase(),
        provenance: "linked",
      }),
    );

    const lock = await subject.lock(lockRequest("ETH"));

    expect(lock.order.merchantSafe.toLowerCase()).toBe(MERCHANT_SAFE.toLowerCase());
  });

  test("no address and no managed wallet is still a refusal", async () => {
    // The alternative is a deployment-wide address, which pays every merchant
    // into the same wallet with no way to tell the payments apart afterwards.
    const { planner: subject } = await planner(null);

    await expect(subject.lock(lockRequest("ETH"))).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("a half-provisioned wallet is not a fallback", async () => {
    // The row is written before the Safe is deployed. Paying a predicted address
    // with no Safe at it sends the money nowhere recoverable.
    const { verifiedAt: _pending, ...pending } = managedWallet();
    const { planner: subject } = await planner(null, pending);

    await expect(subject.lock(lockRequest("ETH"))).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe("the signer applies source-specific settlement rules (#11)", () => {
  function walletRepo() {
    return new InMemoryMerchantWalletRepository();
  }

  test("signs for an explicitly configured external address", async () => {
    const { planner } = createPlanner(
      MERCHANT_SAFE,
      new WalletGuard({ wallets: walletRepo(), treasuryAddresses: [] }),
    );

    const lock = await planner.lock(lockRequest("ETH"));
    expect(lock.order.merchantSafe.toLowerCase()).toBe(MERCHANT_SAFE.toLowerCase());
  });

  test("refuses a treasury address even when the merchant configured it", async () => {
    const { planner } = createPlanner(
      MERCHANT_SAFE,
      new WalletGuard({ wallets: walletRepo(), treasuryAddresses: [MERCHANT_SAFE] }),
    );

    // A fee recipient that is also a payout destination pays a merchant twice
    // and is invisible in the ledger.
    await expect(planner.lock(lockRequest("ETH"))).rejects.toBeInstanceOf(ValidationError);
  });

  test("without a guard the planner signs as before", async () => {
    // A deployment with no chain layer builds no guard; the contract path is
    // off there anyway, and the optionality is what keeps that true.
    const { planner } = createPlanner();
    const lock = await planner.lock(lockRequest("ETH"));
    expect(lock.order.merchantSafe.toLowerCase()).toBe(MERCHANT_SAFE.toLowerCase());
  });
});
