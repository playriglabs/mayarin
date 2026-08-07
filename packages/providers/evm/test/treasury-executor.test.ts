import { describe, expect, test } from "bun:test";
import type { ExecuteRequest, SweepRequest } from "@mayarin/clearing";
import { paymentRouterAbi } from "@mayarin/contracts";
import type { ExecutableRoute, RouteRequest, SwapRouteSource } from "@mayarin/execution";
import { ConfigurationError, money, ProviderError } from "@mayarin/shared";
import { encodeEventTopics, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { depositSalt } from "../src/forwarder-deriver.ts";
import { EvmTreasuryExecutionPort } from "../src/treasury-executor.ts";

const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`);
const FACTORY = "0x00000000000000000000000000000000000fAc70";
const ROUTER = "0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEX = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const DEPOSIT = "0x9ec7B9cCbD9fEb765Eb0DA23c166F5006A0b2343";

const ORDER = {
  intentId: `0x${"11".repeat(32)}`,
  settlementToken: USDC,
  minOut: 3_000_000n,
  fee: 10_000n,
  merchantSafe: "0x000000000000000000000000000000000000bEEF",
  refundTo: "0x0000000000000000000000000000000000007a5b",
  deadline: 1_900_000_000n,
  signature: `0x${"ab".repeat(65)}`,
  signer: ACCOUNT.address,
};

interface Sent {
  to: string;
  data: string;
  value: bigint;
}

/** A `PaymentCompleted` log the adapter can read the measured output back from. */
function paymentCompletedLog(settled: bigint, fee: bigint, refund: bigint) {
  const topics = encodeEventTopics({
    abi: paymentRouterAbi,
    eventName: "PaymentCompleted",
    args: {
      intentId: ORDER.intentId as `0x${string}`,
      merchantSafe: ORDER.merchantSafe as `0x${string}`,
      refundTo: ORDER.refundTo as `0x${string}`,
    },
  });
  // Non-indexed: inputAsset, settlementAsset, inputAmount, settledAmount, fee,
  // refundAmount, deadline.
  const nonIndexed = [
    "0".repeat(24) + "0".repeat(40), // inputAsset  (native)
    "0".repeat(24) + USDC.slice(2).toLowerCase(),
    (10n ** 15n).toString(16).padStart(64, "0"),
    settled.toString(16).padStart(64, "0"),
    fee.toString(16).padStart(64, "0"),
    refund.toString(16).padStart(64, "0"),
    ORDER.deadline.toString(16).padStart(64, "0"),
  ].join("");

  return { address: ROUTER, topics, data: `0x${nonIndexed}` };
}

function fakeRoutes(): SwapRouteSource & { calls: RouteRequest[] } {
  const calls: RouteRequest[] = [];
  return {
    name: "uniswap",
    calls,
    async route(request): Promise<ExecutableRoute> {
      calls.push(request);
      return {
        router: DEX,
        callData: "0xdeadbeef",
        expectedIn: request.maxIn,
        source: "uniswap",
      };
    },
  };
}

function harness(
  options: {
    index?: number | undefined;
    logs?: readonly { address: string; topics: readonly string[]; data: string }[];
    status?: "success" | "reverted";
  } = {},
) {
  const sent: Sent[] = [];
  const routes = fakeRoutes();

  const publicClient = {
    async getChainId() {
      return 84532;
    },
    async readContract({ functionName }: { functionName: string }) {
      // ERC-20 allowance: already approved, so no extra approve transaction.
      if (functionName === "allowance") return [0n, 0, 7] as unknown;
      return 0n;
    },
    async waitForTransactionReceipt() {
      return {
        status: options.status ?? "success",
        gasUsed: 99_061n,
        effectiveGasPrice: 6_000_000n,
        logs: options.logs ?? [paymentCompletedLog(2_990_000n, 10_000n, 80_000n)],
      };
    },
  };

  const walletClient = {
    async sendTransaction({ to, data, value }: { to: string; data: string; value: bigint }) {
      sent.push({ to, data, value });
      return `0x${"fe".repeat(32)}`;
    },
    async signTypedData() {
      return `0x${"cd".repeat(65)}`;
    },
  };

  const port = new EvmTreasuryExecutionPort({
    // biome-ignore lint/suspicious/noExplicitAny: structural fakes for viem clients
    publicClient: publicClient as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural fakes for viem clients
    walletClient: walletClient as any,
    account: ACCOUNT,
    lookup: {
      async indexFor() {
        return options.index === undefined && !("index" in options) ? 3 : options.index;
      },
    },
    routes,
    forwarderFactories: { "base-sepolia": FACTORY },
    paymentRouters: { "base-sepolia": ROUTER },
    tokens: { "base-sepolia": { USDC } },
    nativeAssets: { "base-sepolia": "ETH" },
    confirmations: 1,
  });

  return { port, sent, routes };
}

const SWEEP: SweepRequest = {
  clearingTransactionId: "clr_1",
  chain: "base-sepolia",
  depositAddress: DEPOSIT,
  asset: "ETH",
};

const EXECUTE: ExecuteRequest = {
  clearingTransactionId: "clr_1",
  chain: "base-sepolia",
  order: ORDER,
  inputAmount: money(10n ** 15n, "ETH"),
  attempt: 1,
};

describe("sweeping a deposit", () => {
  test("calls the factory with the salt the deposit address was derived from", async () => {
    const { port, sent } = harness();

    await port.sweep(SWEEP);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(FACTORY);
    expect(sent[0]?.value).toBe(0n);
    // The salt must be the one the address came from, or the factory deploys a
    // forwarder somewhere else entirely and the deposit stays stranded.
    expect(sent[0]?.data).toBe(
      encodeFunctionData({
        abi: parseAbi(["function sweepNative(bytes32 salt) returns (address)"]),
        functionName: "sweepNative",
        args: [depositSalt(3)],
      }),
    );
  });

  test("an ERC-20 deposit sweeps the token, not the native balance", async () => {
    const { port, sent } = harness();

    await port.sweep({ ...SWEEP, asset: "USDC" });

    expect(sent[0]?.data.startsWith("0x")).toBe(true);
    expect(sent[0]?.data).not.toBe(
      encodeFunctionData({
        abi: parseAbi(["function sweepNative(bytes32 salt) returns (address)"]),
        functionName: "sweepNative",
        args: [depositSalt(3)],
      }),
    );
  });

  test("refuses when no derivation index is recorded, rather than guessing", async () => {
    const { port } = harness({ index: undefined });

    // The funds are already at the address; deploying to a guessed salt would
    // strand them permanently.
    await expect(port.sweep(SWEEP)).rejects.toThrow(ConfigurationError);
  });
});

describe("executing a native deposit", () => {
  test("fetches a route into the PaymentRouter and submits payEth with the deposit as value", async () => {
    const { port, sent, routes } = harness();

    await port.execute(EXECUTE);

    expect(routes.calls[0]?.recipient).toBe(ROUTER);
    // Exact-output: the route must deliver the merchant's locked minOut.
    expect(routes.calls[0]?.exactOut).toEqual(money(3_000_000n, "USDC"));
    expect(routes.calls[0]?.maxIn).toEqual(money(10n ** 15n, "ETH"));
    expect(sent[0]?.to).toBe(ROUTER);
    expect(sent[0]?.value).toBe(10n ** 15n);
  });

  test("reports the output the contract measured, not what was quoted", async () => {
    const { port } = harness();

    const result = await port.execute(EXECUTE);

    // settled 2.99 + fee 0.01 + refund 0.08 reconstructs the 3.08 the contract
    // split — the same conservation the contract asserts.
    expect(result.output).toEqual(money(3_080_000n, "USDC"));
    expect(result.gasCost).toEqual(money(99_061n * 6_000_000n, "ETH"));
    expect(result.txHash).toBe(`0x${"fe".repeat(32)}`);
  });

  test("a reverted transaction is retryable, since the router moved nothing", async () => {
    const { port } = harness({ status: "reverted" });

    await expect(port.execute(EXECUTE)).rejects.toThrow(ProviderError);
    await expect(port.execute(EXECUTE)).rejects.toMatchObject({ retryable: true });
  });

  test("a transaction with no PaymentCompleted log is not silently treated as settled", async () => {
    const { port } = harness({ logs: [] });

    await expect(port.execute(EXECUTE)).rejects.toThrow(ProviderError);
  });
});

describe("executing a same-asset ERC-20 deposit", () => {
  test("submits payERC20 with no route at all", async () => {
    const { port, sent, routes } = harness();

    await port.execute({ ...EXECUTE, inputAmount: money(3_100_000n, "USDC") });

    // The contract skips the DEX entirely when input == settlement, so asking a
    // venue for a route would be a lie about what happens.
    expect(routes.calls).toHaveLength(0);
    expect(sent[0]?.to).toBe(ROUTER);
    expect(sent[0]?.value).toBe(0n);
  });
});
