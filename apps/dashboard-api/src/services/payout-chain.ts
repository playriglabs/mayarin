/**
 * The chain side of batch payouts (#295): the calldata a merchant's wallet
 * submits, and the read-back that proves what it moved.
 *
 * One Safe transaction, `DELEGATECALL` into Safe's `MultiSendCallOnly`, which
 * runs every transfer as a plain `CALL` and refuses a nested delegate call —
 * so a batch cannot be used to rewrite the Safe itself. The signature is the
 * pre-validated form (`v = 1`): the Safe accepts it because `msg.sender` is the
 * owner it names, which is why the merchant's own wallet must be the sender.
 *
 * The other source is any wallet at all, paying from its own balance through
 * `PayoutBatcher` (packages/contracts): approve once per token, then one call
 * that `transferFrom`s every row from the caller to its recipient. The batcher
 * holds nothing and has no owner, so it adds no one to trust.
 */

import type { ChainId } from "@mayarin/chain";
import type { ObservedTransfer, PayoutRow } from "@mayarin/payouts";
import type { AssetCode } from "@mayarin/shared";
import {
  type Address,
  concatHex,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  encodePacked,
  getAddress,
  type Hex,
  http,
  pad,
  parseAbi,
  size,
} from "viem";

/** Safe 1.4.1 `MultiSendCallOnly`, at the same address on every chain Safe deployed to. */
export const MULTI_SEND_CALL_ONLY = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";

const SAFE_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
]);
const MULTI_SEND_ABI = parseAbi(["function multiSend(bytes transactions) payable"]);
/**
 * `PayoutBatcher`, deployed with CREATE2 through the canonical deterministic
 * deployer and a fixed salt — one address on every chain.
 */
export const PAYOUT_BATCHER = "0x78F0C40E1Aa5a63DD71E58334586461eB3EB6312";

const BATCHER_ABI = parseAbi([
  "function payout(address[] tokens, address[] recipients, uint256[] amounts)",
]);
const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Token contract per asset on one chain. */
export type TokenAddresses = Readonly<Partial<Record<AssetCode, string>>>;

/**
 * What the wallet sends. `from` is fixed for a Safe batch — only its owner can
 * submit it — and absent for a wallet batch, which any wallet may send.
 */
export interface PayoutTransaction {
  readonly from?: string;
  readonly to: string;
  readonly data: Hex;
}

/** An allowance the paying wallet must have granted the batcher first. */
export interface PayoutApproval {
  readonly asset: AssetCode;
  /** Lowercase token contract. */
  readonly token: string;
  /** The batch total in this token, minor units — what the allowance must cover. */
  readonly amount: bigint;
  /** `approve(PAYOUT_BATCHER, amount)`, ready to send when the allowance falls short. */
  readonly data: Hex;
}

function tokenOf(tokens: TokenAddresses, row: PayoutRow): string {
  const token = tokens[row.amount.asset];
  if (token === undefined) throw new Error(`No token address for ${row.amount.asset}`);
  return token;
}

/** One `PayoutBatcher.payout` call paying every row from the sender's own balance. */
export function batcherTransaction(
  rows: readonly PayoutRow[],
  tokens: TokenAddresses,
): PayoutTransaction {
  return {
    to: PAYOUT_BATCHER.toLowerCase(),
    data: encodeFunctionData({
      abi: BATCHER_ABI,
      functionName: "payout",
      args: [
        rows.map((row) => getAddress(tokenOf(tokens, row))),
        rows.map((row) => getAddress(row.to)),
        rows.map((row) => row.amount.amount),
      ],
    }),
  };
}

/** One approval per token the batch spends, for its total. */
export function batcherApprovals(
  totals: readonly { readonly asset: AssetCode; readonly amount: bigint }[],
  tokens: TokenAddresses,
): readonly PayoutApproval[] {
  return totals.map((total) => {
    const token = tokens[total.asset];
    if (token === undefined) throw new Error(`No token address for ${total.asset}`);
    return {
      asset: total.asset,
      token: token.toLowerCase(),
      amount: total.amount,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [getAddress(PAYOUT_BATCHER), total.amount],
      }),
    };
  });
}

export function payoutTransaction(
  safe: string,
  owner: string,
  rows: readonly PayoutRow[],
  tokens: TokenAddresses,
): PayoutTransaction {
  const packed = rows.map((row) => {
    const token = tokenOf(tokens, row);
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [getAddress(row.to), row.amount.amount],
    });
    return encodePacked(
      ["uint8", "address", "uint256", "uint256", "bytes"],
      [0, getAddress(token), 0n, BigInt(size(data)), data],
    );
  });

  const multiSend = encodeFunctionData({
    abi: MULTI_SEND_ABI,
    functionName: "multiSend",
    args: [concatHex(packed)],
  });
  // r = the owner, s = 0, v = 1: "msg.sender approved this", checked by the Safe.
  const signature = concatHex([pad(getAddress(owner)), pad("0x00"), "0x01"]);

  return {
    from: owner.toLowerCase(),
    to: safe.toLowerCase(),
    data: encodeFunctionData({
      abi: SAFE_ABI,
      functionName: "execTransaction",
      args: [
        getAddress(MULTI_SEND_CALL_ONLY),
        0n,
        multiSend,
        1, // DELEGATECALL into MultiSendCallOnly, which only CALLs onward.
        0n,
        0n,
        0n,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        signature,
      ],
    }),
  };
}

/**
 * One plain `CALL` from a Safe its owner submits, with the same pre-validated
 * signature `payoutTransaction` uses. For an escrow refund (#304), whose payee
 * is the merchant's Safe.
 */
export function safeCallTransaction(
  safe: string,
  owner: string,
  to: string,
  data: `0x${string}`,
): PayoutTransaction {
  const signature = concatHex([pad(getAddress(owner)), pad("0x00"), "0x01"]);
  return {
    from: owner.toLowerCase(),
    to: safe.toLowerCase(),
    data: encodeFunctionData({
      abi: SAFE_ABI,
      functionName: "execTransaction",
      args: [
        getAddress(to),
        0n,
        data,
        0, // CALL
        0n,
        0n,
        0n,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        signature,
      ],
    }),
  };
}

/** What a transaction did, as its receipt says. */
export interface PayoutReceipt {
  readonly succeeded: boolean;
  /** Lowercase. */
  readonly from: string;
  /** Lowercase; absent for a contract creation. */
  readonly to: string | undefined;
  readonly transfers: readonly ObservedTransfer[];
}

/** Reads a submitted payout back off the chain. A port, so tests need no node. */
export interface PayoutReceiptReader {
  receipt(
    chain: ChainId,
    transactionHash: string,
    tokens: TokenAddresses,
  ): Promise<PayoutReceipt | null>;
}

export class ViemPayoutReceiptReader implements PayoutReceiptReader {
  readonly #rpcUrls: Readonly<Partial<Record<ChainId, string>>>;

  constructor(rpcUrls: Readonly<Partial<Record<ChainId, string>>>) {
    this.#rpcUrls = rpcUrls;
  }

  async receipt(
    chain: ChainId,
    transactionHash: string,
    tokens: TokenAddresses,
  ): Promise<PayoutReceipt | null> {
    const rpcUrl = this.#rpcUrls[chain];
    if (rpcUrl === undefined) throw new Error(`No RPC URL configured for ${chain}`);
    const client = createPublicClient({ transport: http(rpcUrl) });

    const receipt = await client
      .getTransactionReceipt({ hash: transactionHash as Hex })
      .catch(() => null);
    if (receipt === null) return null;

    const assetByToken = new Map(
      Object.entries(tokens).map(([asset, token]) => [
        (token ?? "").toLowerCase(),
        asset as AssetCode,
      ]),
    );
    const transfers = receipt.logs.flatMap((log): ObservedTransfer[] => {
      const asset = assetByToken.get(log.address.toLowerCase());
      if (asset === undefined) return [];
      try {
        const event = decodeEventLog({ abi: ERC20_ABI, data: log.data, topics: log.topics });
        if (event.eventName !== "Transfer") return [];
        return [
          {
            from: event.args.from.toLowerCase(),
            to: event.args.to.toLowerCase(),
            amount: { amount: event.args.value, asset },
          },
        ];
      } catch {
        return [];
      }
    });

    return {
      succeeded: receipt.status === "success",
      from: receipt.from.toLowerCase(),
      to: (receipt.to as Address | null)?.toLowerCase(),
      transfers,
    };
  }
}
