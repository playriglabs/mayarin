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
 *    `PRICE_LOCKED` — never re-signed here. When its deadline has passed, the
 *    engine re-signs it (same terms, fresh window) before this port is called.
 */

import { type ChainId, fromChainUnits, toChainUnits } from "@mayarin/chain";
import type {
  DepositReturnPort,
  DepositReturnReceipt,
  DepositReturnRequest,
  ExecuteRequest,
  ExecutionResult,
  SenderLookup,
  SweepRequest,
  SweepResult,
  TreasuryExecutionPort,
} from "@mayarin/clearing";
import { type PaymentCompletedEvent, paymentRouterAbi } from "@mayarin/contracts";
import type { SwapRouteSource } from "@mayarin/execution";
import {
  type AssetCode,
  add,
  ConfigurationError,
  money,
  type NonceSequencer,
  ProviderError,
} from "@mayarin/shared";
import {
  type Account,
  type Address,
  decodeErrorResult,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  type Hex,
  type PublicClient,
  parseEventLogs,
  WaitForTransactionReceiptTimeoutError,
  type WalletClient,
} from "viem";
import { shortReason } from "./errors.ts";
import { depositSalt } from "./forwarder-deriver.ts";
import { validateNativeAssets } from "./native-assets.ts";
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

const erc20TransferEventAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
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
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
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

/** The two clients a chain needs: one to read it, one to sign against it. */
export interface ChainClients {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
}

/** The transactions that put an asset into a deposit address, for reading who sent it. */
export interface DepositTransactionLookup {
  txHashesAt(chain: ChainId, address: string, asset: AssetCode): Promise<readonly string[]>;
}

/**
 * Past this many transactions an account is treated as a wallet that moves volume,
 * the way an exchange's hot wallet does, and its address is not used to return a
 * payer's deposit: a refund there would be credited to nobody.
 */
const DEFAULT_SENDER_MAX_NONCE = 2_000;

export interface EvmTreasuryExecutionPortOptions {
  /** Shared by every submitter of the operator key; see `NonceSequencer`. */
  readonly nonces: NonceSequencer;
  /**
   * Clients per chain, because a deployment settles on more than one.
   *
   * One pair for the whole port sent every submission to whichever chain came
   * first in the router map — so a sweep on Arc was broadcast to Base, where the
   * forwarder factory address has no code, and the node answered `execution
   * reverted` with nothing to say it was the wrong chain.
   */
  readonly clients: Readonly<Partial<Record<ChainId, ChainClients>>>;
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
  /** Where a deposit came in, to read its sender. Absent: no sender is ever vouched for. */
  readonly depositTransactions?: DepositTransactionLookup;
  /** The most transactions a sender may have sent and still be returned to. Defaults to 2000. */
  readonly senderMaxNonce?: number;
  /** Confirmation depth per chain. A chain with no entry uses two. */
  readonly confirmations?: Readonly<Partial<Record<ChainId, number>>>;
  /** How long a signed Permit2 permit stays valid. Seconds. */
  readonly permitTtlSeconds?: number;
  /**
   * The settlement the indexer already recorded for an intent, if any.
   *
   * Read before the chain is searched: it answers however long ago the earlier
   * transaction landed, where a log search reaches back a bounded distance.
   */
  readonly settledBefore?: (
    chain: ChainId,
    intentId: string,
  ) => Promise<IndexedSettlement | undefined>;
}

/** A `PaymentCompleted` already indexed, in the domain's minor units. */
export interface IndexedSettlement {
  readonly txHash: string;
  readonly settledAmount: bigint;
  readonly fee: bigint;
  readonly refundAmount: bigint;
}

export class EvmTreasuryExecutionPort implements TreasuryExecutionPort, DepositReturnPort {
  readonly #options: EvmTreasuryExecutionPortOptions;
  constructor(options: EvmTreasuryExecutionPortOptions) {
    validateNativeAssets(options.nativeAssets ?? {});
    this.#options = options;
  }

  /**
   * Reports what went wrong in one line.
   *
   * viem's send errors carry the whole request — calldata, arguments, docs URL,
   * version — and this one is stored as a payment's failure reason and shown to
   * a merchant. `shortReason` keeps the sentence and drops the transcript.
   *
   * Retryable, all of it: a nonce that raced, a node that had not seen the last
   * broadcast, a provider throttling. The executor bounds how many attempts are
   * worth making; none of these are terminal on their own.
   */
  async #send(work: () => Promise<Hex>): Promise<Hex> {
    try {
      return await work();
    } catch (error) {
      throw new ProviderError(
        `Submitting the transaction failed: ${shortReason(error)}`,
        {},
        { cause: error, retryable: true },
      );
    }
  }

  #clientsFor(chain: ChainId): ChainClients {
    const clients = this.#options.clients[chain];
    if (clients === undefined) {
      throw new ProviderError(
        `No RPC client for ${chain}; the treasury executor cannot submit there`,
        { chain },
        { retryable: false },
      );
    }
    return clients;
  }

  async sweep(request: SweepRequest): Promise<SweepResult> {
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

    return await this.#submit(request.chain, factory, data, 0n);
  }

  supports(chain: ChainId): boolean {
    return this.#options.clients[chain] !== undefined;
  }

  /**
   * Everything that can be checked before a failed deposit goes back to the
   * payer. Nothing here moves value except the sweep, which moves it to the
   * operator, where it already was going.
   */
  async prepare(request: DepositReturnRequest): Promise<SweepResult> {
    const { chain, amount } = request;
    const paymentRouter = this.#addressFor(this.#options.paymentRouters, chain, "PaymentRouter");
    // The router consumes an intent once it has paid. A consumed intent means the
    // merchant was paid, and returning the deposit as well would pay it twice.
    if (await this.#consumed(chain, paymentRouter, request.intentId as Hex)) {
      throw new ProviderError(
        `The router consumed intent ${request.intentId}; the payment settled and its deposit cannot be returned`,
        { intentId: request.intentId },
        { retryable: false },
      );
    }

    const to = getAddress(request.to);
    const own: Address[] = [
      this.#options.account.address,
      getAddress(request.depositAddress),
      paymentRouter,
      this.#addressFor(this.#options.forwarderFactories, chain, "forwarder factory"),
    ];
    const token = this.#tokenAddress(chain, amount.asset);
    if (token !== undefined) own.push(token);
    if (own.some((address) => address === to)) {
      throw new ProviderError(
        `Refusing to return a deposit to ${to}: it is one of Mayarin's own addresses`,
        { to },
        { retryable: false },
      );
    }

    const sweep = await this.sweep({
      clearingTransactionId: request.clearingTransactionId,
      chain,
      depositAddress: request.depositAddress,
      asset: amount.asset,
    });

    const wanted = toChainUnits(chain, amount.asset, amount.amount);
    const held = await this.#operatorBalance(chain, token);
    if (held < wanted) {
      throw new ProviderError(
        `The operator holds ${held} ${amount.asset} base units after the sweep, less than the ${wanted} to return`,
        { clearingTransactionId: request.clearingTransactionId },
        { retryable: false },
      );
    }
    return sweep;
  }

  /**
   * Who sent a deposit, when that can be trusted to be the payer.
   *
   * A sender is a guess, so every way it can be wrong is checked: the transfer came
   * from the account itself and not through a contract (an exchange or a router
   * moves value on someone else's behalf), every deposit came from the same account,
   * the account holds no code (a contract, or an account delegated to one, may not
   * be able to receive, and may not exist on this chain at all), and it has not sent
   * more than `senderMaxNonce` transactions (an exchange hot wallet has sent
   * hundreds of thousands). Anything else is refused with the reason.
   */
  async senderOf(request: Omit<DepositReturnRequest, "to" | "intentId">): Promise<SenderLookup> {
    const { chain, depositAddress, amount } = request;
    const lookup = this.#options.depositTransactions;
    if (lookup === undefined) return { refused: "no way to find the deposit's transaction" };

    const hashes = await lookup.txHashesAt(chain, depositAddress, amount.asset);
    if (hashes.length === 0) return { refused: "no recorded deposit transaction" };

    const { publicClient } = this.#clientsFor(chain);
    const token = this.#tokenAddress(chain, amount.asset);
    const deposit = getAddress(depositAddress);
    const senders = new Set<Address>();

    for (const hash of new Set(hashes)) {
      const transaction = await publicClient.getTransaction({ hash: hash as Hex });
      if (token === undefined) {
        // The chain's own coin has no log, so it is read from the transaction: a plain
        // send to the deposit address. Value moved by a contract is not visible here.
        if (transaction.to === null || getAddress(transaction.to) !== deposit) {
          return { refused: "the deposit was not a direct transfer" };
        }
      } else {
        const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex });
        const transfers = parseEventLogs({
          abi: erc20TransferEventAbi,
          eventName: "Transfer",
          logs: receipt.logs.filter((log) => getAddress(log.address) === token),
        }).filter((log) => getAddress(log.args.to) === deposit);
        if (transfers.length === 0) return { refused: "the deposit has no transfer log" };
        // `tx.from` called the token itself. A transfer made by a router, a Safe or an
        // exchange withdrawal has a different account in the log than in the transaction.
        if (transfers.some((log) => getAddress(log.args.from) !== getAddress(transaction.from))) {
          return { refused: "the deposit was not sent by the transaction's own account" };
        }
      }
      senders.add(getAddress(transaction.from));
    }

    const [sender] = [...senders];
    if (sender === undefined || senders.size > 1) {
      return { refused: "the deposit came from more than one account" };
    }
    if (sender === deposit) return { refused: "the sender is the deposit address" };

    const code = await publicClient.getCode({ address: sender });
    if (code !== undefined && code !== "0x") return { refused: "the sender is a contract" };

    const sent = await publicClient.getTransactionCount({ address: sender });
    const limit = this.#options.senderMaxNonce ?? DEFAULT_SENDER_MAX_NONCE;
    if (sent > limit) {
      return { refused: `the sender has sent ${sent} transactions, like an exchange or a service` };
    }
    return { address: sender };
  }

  async send(request: DepositReturnRequest): Promise<string> {
    const { chain, amount } = request;
    const { account } = this.#options;
    const { publicClient, walletClient } = this.#clientsFor(chain);
    const token = this.#tokenAddress(chain, amount.asset);
    const to = getAddress(request.to);
    const value = toChainUnits(chain, amount.asset, amount.amount);

    const call =
      token === undefined
        ? { to, data: "0x" as Hex, value }
        : {
            to: token,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [to, value],
            }),
            value: 0n,
          };

    return await this.#send(() =>
      this.#options.nonces.broadcast(
        `${chain}:${account.address.toLowerCase()}`,
        () => publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
        (nonce) => walletClient.sendTransaction({ account, ...call, nonce, chain: null }),
        call,
      ),
    );
  }

  async receipt(chain: ChainId, txHash: string): Promise<DepositReturnReceipt> {
    const { publicClient } = this.#clientsFor(chain);
    const receipt = await publicClient
      .waitForTransactionReceipt({
        hash: txHash as Hex,
        confirmations: this.#options.confirmations?.[chain] ?? 2,
        timeout: 30_000,
      })
      .catch((error: unknown) => {
        if (error instanceof WaitForTransactionReceiptTimeoutError) return undefined;
        throw error;
      });
    if (receipt === undefined) return { status: "pending" };
    if (receipt.status !== "success") return { status: "reverted" };
    const gasCost = await this.#gasCost(chain, receipt);
    return gasCost === undefined ? { status: "success" } : { status: "success", gasCost };
  }

  async #operatorBalance(chain: ChainId, token: Address | undefined): Promise<bigint> {
    const { publicClient } = this.#clientsFor(chain);
    const owner = this.#options.account.address;
    return token === undefined
      ? await publicClient.getBalance({ address: owner })
      : await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        });
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
      minOut: toChainUnits(request.chain, settlementAsset, request.order.minOut),
      fee: toChainUnits(request.chain, settlementAsset, request.order.fee),
      merchantSafe: getAddress(request.order.merchantSafe),
      refundTo: getAddress(request.order.refundTo),
      deadline: request.order.deadline,
    };
    const signature = request.order.signature as Hex;

    // Asked before anything is built or sent. The router consumes an intent once,
    // so a payment this has already settled reverts in `eth_estimateGas` — which
    // surfaces as a failed submission and is retried to exhaustion — rather than
    // as the `AlreadyConsumed` the recovery below reads. Finishing it from what
    // the earlier transaction did costs no gas and cannot double-pay.
    if (await this.#consumed(request.chain, paymentRouter, order.intentId)) {
      const earlier = await this.#settledEarlier(
        request.chain,
        paymentRouter,
        order.intentId,
        settlementAsset,
      );
      if (earlier !== undefined) return earlier;
      throw new ProviderError(
        `The router already consumed intent ${order.intentId}, and no earlier settlement could be found`,
        { intentId: order.intentId, revert: "AlreadyConsumed" },
        { retryable: false },
      );
    }

    // A same-asset deposit needs no route at all — the contract skips the
    // router entirely, which is the point of the criterion.
    const route = sameAsset
      ? undefined
      : await this.#options.routes.route({
          payerAsset: request.inputAmount.asset,
          settlementAsset,
          exactOut: money(request.order.minOut, settlementAsset),
          maxIn: request.inputAmount,
          recipient: paymentRouter,
          chain: request.chain,
        });

    const approval =
      inputToken === undefined
        ? undefined
        : await this.#permitFor(
            request.chain,
            inputToken,
            paymentRouter,
            toChainUnits(request.chain, request.inputAmount.asset, request.inputAmount.amount),
          );

    const call =
      inputToken === undefined || approval === undefined
        ? buildPayEthCall({
            paymentRouter,
            order,
            signature,
            // Native always differs from an ERC-20 settlement asset, so the
            // route is mandatory and `route` is defined here.
            route: requireRoute(route),
            value: toChainUnits(
              request.chain,
              request.inputAmount.asset,
              request.inputAmount.amount,
            ),
          })
        : buildPayERC20Call({
            paymentRouter,
            order,
            signature,
            permit: approval.permit,
            permitSignature: approval.permitSignature,
            ...(route === undefined ? {} : { route }),
          });

    try {
      const result = await this.#submit(request.chain, call.to, call.data, call.value, {
        paymentRouter,
        settlementAsset,
      });
      // The one-off Permit2 approval is a transaction of its own, paid for by
      // the same payment.
      return approval?.gasCost === undefined || result.gasCost === undefined
        ? result
        : { ...result, gasCost: add(result.gasCost, approval.gasCost) };
    } catch (error) {
      // The router consumes an intent once. `AlreadyConsumed` therefore means an
      // earlier transaction of ours settled this payment — a crash between the
      // broadcast and the state change, or a pass that overlapped another's —
      // and failing it would report as lost what is already paid. The earlier
      // transaction's own log says what it did.
      if (!(error instanceof ProviderError) || error.details.revert !== "AlreadyConsumed") {
        throw error;
      }
      const revertedAt = error.details.blockNumber;
      const earlier = await this.#settledEarlier(
        request.chain,
        paymentRouter,
        order.intentId,
        settlementAsset,
        typeof revertedAt === "string" ? BigInt(revertedAt) : undefined,
      );
      if (earlier === undefined) throw error;
      return earlier;
    }
  }

  /** Whether the router has consumed this intent — a settled payment, by the router's own word. */
  async #consumed(chain: ChainId, paymentRouter: Address, intentId: Hex): Promise<boolean> {
    const consumed = await this.#clientsFor(chain).publicClient.readContract({
      address: paymentRouter,
      abi: paymentRouterAbi,
      functionName: "consumed",
      args: [intentId],
    });
    return consumed === true;
  }

  /**
   * The result of the transaction that already settled this intent, or
   * `undefined` when nothing says what that transaction did.
   *
   * The indexer's record is read first. Failing that the router's
   * `PaymentCompleted` log is searched back a bounded distance from `searchTo`
   * (the latest block when there is none), since a provider caps the span of one
   * `eth_getLogs`. A miss leaves the caller's error to stand.
   */
  async #settledEarlier(
    chain: ChainId,
    paymentRouter: Address,
    intentId: Hex,
    settlementAsset: AssetCode,
    searchTo?: bigint,
  ): Promise<ExecutionResult | undefined> {
    try {
      const indexed = await this.#options.settledBefore?.(chain, intentId);
      if (indexed !== undefined) {
        return await this.#earlierResult(
          chain,
          settlementAsset,
          indexed.txHash as Hex,
          indexed.settledAmount + indexed.fee + indexed.refundAmount,
        );
      }

      const { publicClient } = this.#clientsFor(chain);
      const toBlock = searchTo ?? (await publicClient.getBlockNumber());
      const logs = await publicClient.getLogs({
        address: paymentRouter,
        event: PAYMENT_COMPLETED_EVENT,
        args: { intentId },
        fromBlock: toBlock > SETTLED_EARLIER_LOOKBACK ? toBlock - SETTLED_EARLIER_LOOKBACK : 0n,
        toBlock,
      });
      const log = logs[0];
      if (log === undefined || log.transactionHash === null) return undefined;
      const { settledAmount, fee, refundAmount } = log.args;
      if (settledAmount === undefined || fee === undefined || refundAmount === undefined) {
        return undefined;
      }
      return await this.#earlierResult(
        chain,
        settlementAsset,
        log.transactionHash,
        fromChainUnits(chain, settlementAsset, settledAmount + fee + refundAmount),
      );
    } catch {
      // A provider that refuses the range, or a node that cannot answer: the
      // caller's error is the honest report.
      return undefined;
    }
  }

  /** What the earlier transaction delivered, in domain units, with the gas it cost. */
  async #earlierResult(
    chain: ChainId,
    settlementAsset: AssetCode,
    txHash: Hex,
    output: bigint,
  ): Promise<ExecutionResult> {
    const receipt = await this.#clientsFor(chain).publicClient.getTransactionReceipt({
      hash: txHash,
    });
    const gasCost = await this.#gasCost(chain, receipt);
    return {
      txHash,
      output: money(output, settlementAsset),
      ...(gasCost === undefined ? {} : { gasCost }),
    };
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
    chain: ChainId,
    token: Address,
    paymentRouter: Address,
    amount: bigint,
  ): Promise<{ permit: Permit2Single; permitSignature: Hex; gasCost?: Money }> {
    const { account } = this.#options;
    const { publicClient, walletClient } = this.#clientsFor(chain);

    const approved = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, PERMIT2],
    });

    let gasCost: Money | undefined;
    if (approved < amount) {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2, 2n ** 256n - 1n],
      });
      gasCost = (await this.#submit(chain, token, data, 0n)).gasCost;
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

    const permitSignature = await walletClient.signTypedData({
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

    return { permit, permitSignature, ...(gasCost === undefined ? {} : { gasCost }) };
  }

  /**
   * One plain call from the operator, under the same nonce lock as every other
   * submission, waited to the confirmation depth. For the escrow keeper (#304),
   * which shares this key and this process. Throws on a revert.
   */
  async call(chain: ChainId, to: string, data: Hex): Promise<string> {
    const { txHash } = await this.#submit(chain, getAddress(to), data, 0n);
    return txHash;
  }

  /** Submits, waits for the confirmation depth, and measures what it produced. */
  async #submit(
    chain: ChainId,
    to: Address,
    data: Hex,
    value: bigint,
    measure?: { paymentRouter: Address; settlementAsset: AssetCode },
  ): Promise<ExecutionResult> {
    const { account } = this.#options;
    const { publicClient, walletClient } = this.#clientsFor(chain);

    // Nonce read and broadcast happen together under the sequencer's lock, which
    // is shared with every other submitter of this key. Left to viem the nonce is
    // fetched per call and cached across back-to-back sends, which is exactly
    // the collision this exists to prevent.
    const hash = await this.#send(() =>
      this.#options.nonces.broadcast(
        `${chain}:${account.address.toLowerCase()}`,
        () => publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
        (nonce) => walletClient.sendTransaction({ account, to, data, value, nonce, chain: null }),
        { to, data, value },
      ),
    );
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: this.#options.confirmations?.[chain] ?? 2,
    });

    // Gas is paid in the chain's own currency, which is not ETH everywhere —
    // Arc's is USDC. A chain that has not declared one gets **no** gas figure
    // rather than a number labelled with the wrong asset: the ledger would post
    // it, and a posting in an asset the chain does not have is worse than an
    // unmeasured cost.
    const gasCost = await this.#gasCost(chain, receipt);

    if (receipt.status !== "success") {
      throw await this.#revertedTransaction({
        chain,
        hash,
        to,
        data,
        value,
        blockNumber: receipt.blockNumber,
      });
    }

    if (measure === undefined) {
      return {
        txHash: hash,
        output: money(0n, "ETH"),
        ...(gasCost === undefined ? {} : { gasCost }),
      };
    }

    return {
      txHash: hash,
      output: this.#outputFrom(chain, receipt.logs, measure.paymentRouter, measure.settlementAsset),
      ...(gasCost === undefined ? {} : { gasCost }),
    };
  }

  /**
   * What a transaction cost in the chain's native currency.
   *
   * `gasUsed * effectiveGasPrice` is the whole bill on most chains, and on
   * Arbitrum, where the L1 share is folded into `gasUsed`. On an OP-stack chain
   * (Base) the L1 data fee is a separate receipt field that viem drops unless the
   * client was built with that chain's formatters, so it is read from the raw
   * receipt — otherwise every Base payment books its gas short.
   */
  async #gasCost(
    chain: ChainId,
    receipt: { transactionHash: Hex; gasUsed: bigint; effectiveGasPrice: bigint },
  ): Promise<Money | undefined> {
    const gasAsset = this.#options.nativeAssets[chain];
    if (gasAsset === undefined) return undefined;

    // The transaction is already confirmed, so a node that cannot answer this
    // must not fail the step: a retry would only resubmit work that is done.
    const l1Fee = await this.#clientsFor(chain)
      .publicClient.request({
        method: "eth_getTransactionReceipt",
        params: [receipt.transactionHash],
      })
      .then((raw) => (raw as { l1Fee?: Hex } | null)?.l1Fee ?? "0x0")
      .then(BigInt)
      .catch(() => 0n);

    return money(receipt.gasUsed * receipt.effectiveGasPrice + l1Fee, gasAsset);
  }

  /** Replays a reverted call to recover the router's custom-error selector. */
  async #revertedTransaction(request: {
    readonly chain: ChainId;
    readonly hash: Hex;
    readonly to: Address;
    readonly data: Hex;
    readonly value: bigint;
    readonly blockNumber: bigint;
  }): Promise<ProviderError> {
    try {
      await this.#clientsFor(request.chain).publicClient.call({
        account: this.#options.account,
        to: request.to,
        data: request.data,
        value: request.value,
        blockNumber: request.blockNumber,
      });
    } catch (error) {
      const data = errorData(error);
      if (data !== undefined) {
        try {
          const decoded = decodeErrorResult({ abi: paymentRouterAbi, data });
          const retryable = !TERMINAL_ROUTER_ERRORS.has(decoded.errorName);
          return new ProviderError(
            `Transaction ${request.hash} reverted with ${decoded.errorName}`,
            {
              hash: request.hash,
              to: request.to,
              revert: decoded.errorName,
              blockNumber: request.blockNumber.toString(),
            },
            { cause: error, retryable },
          );
        } catch {
          // The revert may belong to Permit2, a token or the swap router. Keep
          // the existing bounded-retry behaviour when it is not our selector.
        }
      }
    }

    return new ProviderError(
      `Transaction ${request.hash} reverted with an unknown reason`,
      { hash: request.hash, to: request.to },
      { retryable: true },
    );
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
    chain: ChainId,
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
        return money(
          fromChainUnits(chain, settlementAsset, args.settledAmount + args.fee + args.refundAmount),
          settlementAsset,
        );
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

/** How far back from a revert to look for the transaction that consumed the intent. */
const SETTLED_EARLIER_LOOKBACK = 2_000n;

const PAYMENT_COMPLETED_EVENT = paymentRouterAbi.find(
  (entry): entry is PaymentCompletedEvent =>
    entry.type === "event" && entry.name === "PaymentCompleted",
) as PaymentCompletedEvent;

const TERMINAL_ROUTER_ERRORS: ReadonlySet<string> = new Set([
  "AlreadyConsumed",
  "ExpiredOrder",
  "InvalidSigner",
]);

function errorData(error: unknown): Hex | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const data = (error as { data?: unknown }).data;
  if (typeof data === "string" && /^0x[0-9a-fA-F]+$/.test(data)) return data as Hex;

  return errorData((error as { cause?: unknown }).cause);
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
