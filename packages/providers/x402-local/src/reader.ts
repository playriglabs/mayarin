/**
 * The read-only half of the local facilitator.
 *
 * Everything an x402 payment can be checked for without a key lives here:
 * signature recovery, balance, nonce state, simulation, and reading a
 * settlement transaction back off the chain. It holds a `PublicClient` and
 * nothing else.
 *
 * The split is the same one `EvmChainClient` and `EvmTreasuryExecutionPort`
 * already make, and for the same reason — a bug in the checking path has
 * nothing to move funds with. `LocalX402Facilitator` is where that property is
 * knowingly given up, for one method.
 */

import type { ChainId } from "@mayarin/chain";
import { caip2Of, EVM_CHAIN_IDS } from "@mayarin/chain";
import { ProviderError, ValidationError } from "@mayarin/shared";
import type {
  ConfirmedTransfer,
  InvalidReason,
  PaymentPayload,
  PaymentRequirements,
  SettlementConfirmer,
} from "@mayarin/x402";
import {
  checkStatically,
  domainOf,
  eip3009PayloadOf,
  parseUnixSeconds,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from "@mayarin/x402";
import { type Address, decodeEventLog, type Hex, type PublicClient, verifyTypedData } from "viem";
import { eip3009Abi } from "./abi.ts";

/**
 * `transferWithAuthorization` arguments, with the signature split into
 * `(v, r, s)` — the form Circle's `FiatTokenV2` exposes. The packed-bytes
 * overload is a later addition not every deployment has.
 */
export type TransferWithAuthorizationArgs = readonly [
  Address,
  Address,
  bigint,
  bigint,
  bigint,
  Hex,
  number,
  Hex,
  Hex,
];

export interface EvmX402ReaderOptions {
  readonly chain: ChainId;
  readonly publicClient: PublicClient;
}

export class EvmX402Reader implements SettlementConfirmer {
  readonly chain: ChainId;
  readonly network: string;
  readonly #client: PublicClient;

  constructor(options: EvmX402ReaderOptions) {
    this.chain = options.chain;
    this.network = caip2Of(options.chain);
    this.#client = options.publicClient;
  }

  /**
   * The four checks that need a chain, run after the pure ones.
   *
   * Returns the first failure, in the specification's own order: signature,
   * balance, then the nonce, then simulation. Ordering is not cosmetic — the
   * cheap local check runs before the RPC calls, and simulation runs last
   * because it is the only one that costs a node real work.
   *
   * `undefined` means nothing is wrong with the payment. It does not mean the
   * transfer happened; only `confirm` says that.
   */
  async check(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
    now: Date,
  ): Promise<InvalidReason | undefined> {
    const staticReason = checkStatically(payment, requirements, now);
    if (staticReason !== undefined) return staticReason;

    const { signature, authorization } = eip3009PayloadOf(payment);
    const asset = requirements.asset as Address;
    const from = authorization.from as Address;

    const domain = domainOf(requirements, Number(EVM_CHAIN_IDS[this.chain]));
    const recovered = await verifyTypedData({
      address: from,
      domain: { ...domain, verifyingContract: domain.verifyingContract as Address },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from,
        to: authorization.to as Address,
        value: BigInt(authorization.value),
        validAfter: parseUnixSeconds(authorization.validAfter, "validAfter"),
        validBefore: parseUnixSeconds(authorization.validBefore, "validBefore"),
        nonce: authorization.nonce as Hex,
      },
      signature: signature as Hex,
    });
    if (!recovered) return "invalid_signature";

    const balance = await this.#client.readContract({
      address: asset,
      abi: eip3009Abi,
      functionName: "balanceOf",
      args: [from],
    });
    if (balance < BigInt(requirements.amount)) return "insufficient_funds";

    // A nonce the token has already recorded is not a replay we can absorb —
    // the transfer either happened or somebody else spent the authorization.
    // Either way broadcasting it again buys a revert.
    const used = await this.#client.readContract({
      address: asset,
      abi: eip3009Abi,
      functionName: "authorizationState",
      args: [from, authorization.nonce as Hex],
    });
    if (used) return "authorization_already_used";

    try {
      await this.#client.simulateContract({
        address: asset,
        abi: eip3009Abi,
        functionName: "transferWithAuthorization",
        args: this.callArgsFor(payment),
      });
    } catch {
      // The reason a simulation failed is the node's, phrased for a developer.
      // `invalidReason` is a closed set a payer's client branches on, so the
      // detail is dropped here rather than smuggled through as free text.
      return "simulation_failed";
    }

    return undefined;
  }

  /**
   * The arguments a settlement broadcasts — the same ones `check` simulated, so
   * the transaction sent is the transaction that was proved to work.
   */
  callArgsFor(payment: PaymentPayload): TransferWithAuthorizationArgs {
    const { signature, authorization } = eip3009PayloadOf(payment);
    const hex = signature.slice(2);
    const r = `0x${hex.slice(0, 64)}` as Hex;
    const s = `0x${hex.slice(64, 128)}` as Hex;
    // Wallets differ on whether `v` is 27/28 or 0/1; the token expects the
    // former, and a 0/1 signature would recover to a different address rather
    // than fail loudly.
    const raw = Number.parseInt(hex.slice(128, 130), 16);
    const v = raw < 27 ? raw + 27 : raw;

    return [
      authorization.from as Address,
      authorization.to as Address,
      BigInt(authorization.value),
      parseUnixSeconds(authorization.validAfter, "validAfter"),
      parseUnixSeconds(authorization.validBefore, "validBefore"),
      authorization.nonce as Hex,
      v,
      r,
      s,
    ];
  }

  /**
   * The transfer a settlement transaction actually made.
   *
   * `undefined` when the chain has no such transaction — the case the whole
   * confirmation guard exists for, and not an error: a facilitator reporting
   * success for a hash that does not exist is exactly the lie being caught.
   *
   * A reverted transaction is also `undefined`. It exists, and it moved
   * nothing.
   */
  async confirm(
    transaction: string,
    network: string,
    asset: string,
  ): Promise<ConfirmedTransfer | undefined> {
    if (network !== this.network) {
      throw new ValidationError(`this reader confirms ${this.network}, was asked for ${network}`, {
        expected: this.network,
        received: network,
      });
    }

    const receipt = await this.#client
      .getTransactionReceipt({ hash: transaction as Hex })
      .catch(() => undefined);
    if (receipt === undefined) return undefined;
    if (receipt.status !== "success") return undefined;

    const transfers = receipt.logs.flatMap((log) => {
      // Only the token being settled. Arc's own currency is USDC, so one
      // payment emits a `Transfer` on the native view and another on the ERC-20
      // view — one movement described twice, on two contracts.
      if (log.address.toLowerCase() !== asset.toLowerCase()) return [];
      try {
        const decoded = decodeEventLog({ abi: eip3009Abi, data: log.data, topics: log.topics });
        if (decoded.eventName !== "Transfer") return [];
        return [
          {
            from: decoded.args.from,
            to: decoded.args.to,
            value: decoded.args.value.toString(),
            asset: log.address,
          } satisfies ConfirmedTransfer,
        ];
      } catch {
        // Not a Transfer, or not one this ABI can read. Every settlement
        // transaction carries other logs — `AuthorizationUsed`, at minimum.
        return [];
      }
    });

    const [only, second] = transfers;
    if (only === undefined) return undefined;
    // More than one movement in a settlement transaction is not something to
    // choose between. Picking the first would be a guess, and the thing being
    // guessed at is which transfer paid the merchant.
    if (second !== undefined) {
      throw new ProviderError(
        `x402 settlement ${transaction} carries ${transfers.length} transfers; cannot tell which paid`,
        { transaction, network, transfers: transfers.length },
        { retryable: false },
      );
    }
    return only;
  }
}
