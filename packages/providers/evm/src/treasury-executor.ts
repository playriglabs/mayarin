/**
 * EVM adapter for `TreasuryExecutionPort` (RFC #69, issue #81).
 *
 * The only component in the system holding a key that can move funds.
 * `ChainClient` is read-only and `HdDepositAddressDeriver` holds a watch-only
 * xpub, both so a bug in the watch path has nothing to move funds with. This is
 * where that property is knowingly given up, for one caller — see the custody
 * section of `docs/threat-model.md`.
 *
 * Two transactions per payment:
 *
 * 1. `factory.sweepNative(salt)` / `sweepToken(salt, token)` deploys the
 *    counterfactual forwarder at the deposit address and moves the balance to
 *    the operator, which pays the gas.
 * 2. `payEth` / `payERC20` on `PaymentRouter`, carrying the order signed at
 *    `PRICE_LOCKED` — never re-signed here.
 */

import type { ChainId } from "@mayarin/chain";
import type {
  ExecuteRequest,
  ExecutionResult,
  SweepRequest,
  TreasuryExecutionPort,
} from "@mayarin/clearing";
import { paymentRouterAbi } from "@mayarin/contracts";
import type { SwapRouteSource } from "@mayarin/execution";
import { type AssetCode, ConfigurationError, money, ProviderError } from "@mayarin/shared";
import {
  type Account,
  type Address,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { depositSalt } from "./forwarder-deriver.ts";
import { buildPayERC20Call, buildPayEthCall, type Permit2Single } from "./payment-router.ts";

/** Canonical Uniswap Permit2 — the address `PaymentRouter` was deployed against. */
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const forwarderFactoryAbi = [
  {
    type: "function",
    name: "sweepNative",
    stateMutability: "nonpayable",
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ name: "forwarder", type: "address" }],
  },
  {
    type: "function",
    name: "sweepToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "salt", type: "bytes32" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "forwarder", type: "address" }],
  },
] as const;

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** EIP-712 types Permit2 verifies a `PermitSingle` against. */
const PERMIT2_TYPES = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

/**
 * Resolves a payment to the derivation index its deposit salt comes from.
 *
 * Keyed by clearing transaction rather than by address because that is what
 * `DepositAddressRepository` already indexes — adding an address lookup would
 * be a second index over the same row.
 */
export interface DepositIndexLookup {
  indexFor(clearingTransactionId: string): Promise<number | undefined>;
}

export interface EvmTreasuryExecutionPortOptions {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly account: Account;
  readonly lookup: DepositIndexLookup;
  readonly routes: SwapRouteSource;
  /** `DepositForwarderFactory` per chain. */
  readonly forwarderFactories: Readonly<Partial<Record<ChainId, string>>>;
  /** `PaymentRouter` per chain. */
  readonly paymentRouters: Readonly<Partial<Record<ChainId, string>>>;
  /** ERC-20 address per chain and asset. A native asset has none. */
  readonly tokens: Readonly<Partial<Record<ChainId, Readonly<Record<string, string>>>>>;
  /** The chain's native asset, so the adapter knows what needs no token address. */
  readonly nativeAssets: Readonly<Partial<Record<ChainId, AssetCode>>>;
  readonly confirmations?: number;
  /** How long a signed Permit2 permit stays valid. Seconds. */
  readonly permitTtlSeconds?: number;
}

export class EvmTreasuryExecutionPort implements TreasuryExecutionPort {
  readonly #options: EvmTreasuryExecutionPortOptions;
  /**
   * Serialises submissions from the operator account.
   *
   * One key signs every sweep and every router call, and a nonce is a property
   * of that key rather than of a payment. Two payments settling at the same
   * moment both read the pending nonce, both get `N`, and the second is
   * rejected `replacement transaction underpriced` — not because anything is
   * wrong with it, but because it bid the same gas for a slot already taken.
   * The payer's asset is sitting at a deposit address by then, so the cost of
   * losing that race is a stuck payment rather than a retryable blip.
   *
   * A promise chain is enough. The critical section is the nonce read plus the
   * broadcast, not the wait for confirmations: once a transaction is in the
   * mempool the next `pending` read already counts it, so holding the lock
   * through a receipt would serialise confirmations for no benefit.
   */
  #submissions: Promise<unknown> = Promise.resolve();

  constructor(options: EvmTreasuryExecutionPortOptions) {
    this.#options = options;
  }

  /** Runs `work` after every submission queued before it, failures included. */
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#submissions.then(work, work);
    // The chain must not inherit a rejection, or one failed submission would
    // reject every later one without ever running it.
    this.#submissions = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async sweep(request: SweepRequest): Promise<void> {
    const factory = this.#addressFor(
      this.#options.forwarderFactories,
      request.chain,
      "forwarder factory",
    );
    const index = await this.#options.lookup.indexFor(request.clearingTransactionId);

    if (index === undefined) {
      // The salt derives from the index, so without it the forwarder cannot be
      // deployed and the deposit cannot be moved. Loud, because the payer's
      // funds are already sitting at that address.
      throw new ConfigurationError(
        `No derivation index recorded for deposit address ${request.depositAddress}`,
        {
          clearingTransactionId: request.clearingTransactionId,
          depositAddress: request.depositAddress,
          chain: request.chain,
        },
      );
    }

    const salt = depositSalt(index);
    const token = this.#tokenAddress(request.chain, request.asset);

    const data =
      token === undefined
        ? encodeFunctionData({
            abi: forwarderFactoryAbi,
            functionName: "sweepNative",
            args: [salt],
          })
        : encodeFunctionData({
            abi: forwarderFactoryAbi,
            functionName: "sweepToken",
            args: [salt, token],
          });

    await this.#submit(factory, data, 0n);
  }

  async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const paymentRouter = this.#addressFor(
      this.#options.paymentRouters,
      request.chain,
      "PaymentRouter",
    );
    const settlementAsset = this.#assetForToken(request.chain, request.order.settlementToken);
    const inputToken = this.#tokenAddress(request.chain, request.inputAmount.asset);
    const sameAsset =
      inputToken !== undefined && inputToken === getAddress(request.order.settlementToken);

    const order = {
      intentId: request.order.intentId as Hex,
      settlementToken: getAddress(request.order.settlementToken),
      minOut: request.order.minOut,
      fee: request.order.fee,
      merchantSafe: getAddress(request.order.merchantSafe),
      refundTo: getAddress(request.order.refundTo),
      deadline: request.order.deadline,
    };
    const signature = request.order.signature as Hex;

    // A same-asset deposit needs no route at all — the contract skips the
    // router entirely, which is the point of the criterion.
    const route = sameAsset
      ? undefined
      : await this.#options.routes.route({
          payerAsset: request.inputAmount.asset,
          settlementAsset,
          exactOut: money(order.minOut, settlementAsset),
          maxIn: request.inputAmount,
          recipient: paymentRouter,
        });

    const call =
      inputToken === undefined
        ? buildPayEthCall({
            paymentRouter,
            order,
            signature,
            // Native always differs from an ERC-20 settlement asset, so the
            // route is mandatory and `route` is defined here.
            route: requireRoute(route),
            value: request.inputAmount.amount,
          })
        : buildPayERC20Call({
            paymentRouter,
            order,
            signature,
            ...(await this.#permitFor(inputToken, paymentRouter, request.inputAmount.amount)),
            ...(route === undefined ? {} : { route }),
          });

    return this.#submit(call.to, call.data, call.value, { paymentRouter, settlementAsset });
  }

  /**
   * Signs a Permit2 `PermitSingle` for the operator.
   *
   * `payERC20` calls `permit()` unconditionally, so the nonce must be the one
   * Permit2 currently holds — a stale nonce reverts the whole payment. Read it
   * rather than track it: the operator may have been used concurrently.
   *
   * Also ensures the operator has approved Permit2 on the token, which every
   * Permit2 owner must do once before any pull can work.
   */
  async #permitFor(
    token: Address,
    paymentRouter: Address,
    amount: bigint,
  ): Promise<{ permit: Permit2Single; permitSignature: Hex }> {
    const { publicClient, account } = this.#options;

    const approved = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, PERMIT2],
    });

    if (approved < amount) {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2, 2n ** 256n - 1n],
      });
      await this.#submit(token, data, 0n);
    }

    const [, , nonce] = await publicClient.readContract({
      address: PERMIT2,
      abi: permit2Abi,
      functionName: "allowance",
      args: [account.address, token, paymentRouter],
    });

    const expiry = BigInt(
      Math.floor(Date.now() / 1_000) + (this.#options.permitTtlSeconds ?? 1_800),
    );
    const permit: Permit2Single = {
      token,
      amount,
      expiration: Number(expiry),
      nonce,
      spender: paymentRouter,
      sigDeadline: expiry,
    };

    const permitSignature = await this.#options.walletClient.signTypedData({
      account,
      domain: {
        name: "Permit2",
        chainId: await publicClient.getChainId(),
        verifyingContract: PERMIT2,
      },
      types: PERMIT2_TYPES,
      primaryType: "PermitSingle",
      message: {
        details: {
          token,
          amount,
          expiration: Number(expiry),
          nonce,
        },
        spender: paymentRouter,
        sigDeadline: expiry,
      },
    });

    return { permit, permitSignature };
  }

  /** Submits, waits for the confirmation depth, and measures what it produced. */
  async #submit(
    to: Address,
    data: Hex,
    value: bigint,
    measure?: { paymentRouter: Address; settlementAsset: AssetCode },
  ): Promise<ExecutionResult> {
    const { publicClient, walletClient, account } = this.#options;

    // Nonce read and broadcast happen together under the lock. Left to viem the
    // nonce is fetched per call and cached across back-to-back sends, which is
    // exactly the collision this exists to prevent.
    const hash = await this.#serialize(async () => {
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      return walletClient.sendTransaction({ account, to, data, value, nonce, chain: null });
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: this.#options.confirmations ?? 2,
    });

    const gasCost = money(receipt.gasUsed * receipt.effectiveGasPrice, "ETH");

    if (receipt.status !== "success") {
      // Retryable: the router hard-reverts on a `minOut` miss without moving
      // funds, and a stale route looks the same. The executor decides whether
      // another attempt is worth it, and bounds how many.
      throw new ProviderError(`Transaction ${hash} reverted`, { hash, to }, { retryable: true });
    }

    if (measure === undefined) {
      return { txHash: hash, output: money(0n, "ETH"), gasCost };
    }

    return {
      txHash: hash,
      output: this.#outputFrom(receipt.logs, measure.paymentRouter, measure.settlementAsset),
      gasCost,
    };
  }

  /**
   * What the swap actually delivered, read back from `PaymentCompleted`.
   *
   * `settledAmount + fee + refundAmount` reconstructs the output the contract
   * measured and split — the same conservation the contract asserts. Reading it
   * rather than trusting the quote is the whole point: the gap between them is
   * the FX result.
   */
  #outputFrom(
    logs: readonly { address: string; topics: readonly string[]; data: string }[],
    paymentRouter: Address,
    settlementAsset: AssetCode,
  ): Money {
    for (const log of logs) {
      if (getAddress(log.address) !== paymentRouter) continue;

      try {
        const decoded = decodeEventLog({
          abi: paymentRouterAbi,
          data: log.data as Hex,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName !== "PaymentCompleted") continue;

        const args = decoded.args as unknown as {
          settledAmount: bigint;
          fee: bigint;
          refundAmount: bigint;
        };
        return money(args.settledAmount + args.fee + args.refundAmount, settlementAsset);
      } catch {
        // Not one of ours: the router's transaction also carries the DEX's logs.
      }
    }

    throw new ProviderError(
      "The payment transaction emitted no PaymentCompleted log",
      { paymentRouter },
      { retryable: false },
    );
  }

  #addressFor(
    map: Readonly<Partial<Record<ChainId, string>>>,
    chain: ChainId,
    what: string,
  ): Address {
    const address = map[chain];
    if (address === undefined) {
      throw new ConfigurationError(`No ${what} configured for chain ${chain}`, { chain });
    }
    return getAddress(address);
  }

  /** `undefined` for the chain's native asset, which has no token address. */
  #tokenAddress(chain: ChainId, asset: AssetCode): Address | undefined {
    if (this.#options.nativeAssets[chain] === asset) return undefined;

    const address = this.#options.tokens[chain]?.[asset];
    if (address === undefined) {
      throw new ConfigurationError(`No token address for ${asset} on ${chain}`, { chain, asset });
    }
    return getAddress(address);
  }

  #assetForToken(chain: ChainId, token: string): AssetCode {
    const target = getAddress(token);
    for (const [asset, address] of Object.entries(this.#options.tokens[chain] ?? {})) {
      if (getAddress(address) === target) return asset as AssetCode;
    }
    throw new ConfigurationError(`No asset configured for settlement token ${token} on ${chain}`, {
      chain,
      token,
    });
  }
}

function requireRoute<T>(route: T | undefined): T {
  if (route === undefined) {
    throw new ConfigurationError(
      "A native deposit always needs a route: the payer asset cannot be the ERC-20 settlement asset",
      {},
    );
  }
  return route;
}

type Money = ReturnType<typeof money>;
