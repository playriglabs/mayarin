import { describe, expect, test } from "bun:test";
import { BasisPointsFeePolicy } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { priceSourceOf } from "@mayarin/execution";
import { FixedSwapVenue } from "@mayarin/execution/testing";
import { QuoteEngine } from "@mayarin/quote";
import { FakeOrderSigner } from "@mayarin/quote/testing";
import { ConfigurationError, FixedClock, money, ValidationError } from "@mayarin/shared";
import { InMemoryStablecoinRegistry } from "@mayarin/stablecoin";
import { type MerchantWallet, SettlementAddressResolver, WalletGuard } from "@mayarin/wallet";
import { InMemoryMerchantWalletRepository } from "@mayarin/wallet/testing";
import { ApiContractPlanner } from "../src/contract-layer.ts";
import type { QuoteLayer } from "../src/quote-layer.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const ROUTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
const MERCHANT_SAFE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYER = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";
const USDC_TOKEN = "0x00000000000000000000000000000000000001d1";

/** 60,000,000.00 USDC per whole ETH. */
const ETH_USDC_RATE = 6_000_000_000n;

// `null` means the merchant has no settlement address; `undefined` would be
// swallowed by the default parameter and silently pass the address through.
function createPlanner(
  settlementAddress: string | null = MERCHANT_SAFE,
  wallets?: WalletGuard,
  settlementAddresses?: SettlementAddressResolver,
  relayerGasFeeBasisPoints = 10,
  feeMinimum = "0",
) {
  const clock = new FixedClock(NOW);
  const venue = new FixedSwapVenue("0x", [
    { from: "ETH", to: "USDC", scaledRate: ETH_USDC_RATE, source: "0x" },
  ]);
  const oracle = new FixedPriceOracle([
    {
      from: "ETH",
      to: "USDC",
      scaledRate: ETH_USDC_RATE,
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
    contract: { paymentRouters: { base: ROUTER } },
    quote: async () => quote,
    fees: new BasisPointsFeePolicy(50, feeMinimum),
    relayerGasFees: new BasisPointsFeePolicy(relayerGasFeeBasisPoints),
    stablecoins: new InMemoryStablecoinRegistry([
      { asset: "USDC", onChain: [{ chain: "base", address: USDC_TOKEN }] },
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
    clock,
  });
  return { planner, venue, signer, clock };
}

function lockRequest(payerAsset: "ETH" | "USDC") {
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

  test("a chain without a deployed router is refused", async () => {
    const { planner } = createPlanner();

    expect(planner.lock({ ...lockRequest("ETH"), chain: "base-sepolia" })).rejects.toThrow(
      /No PaymentRouter deployed/,
    );
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
