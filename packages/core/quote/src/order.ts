/**
 * EIP-712 order assembly (RFC #6 — #40).
 *
 * Maps a `LockedQuote` plus intent context onto the `Order` struct that
 * `PaymentRouter` verifies (#24), and defines the `OrderSigner` port that
 * turns an assembled order into a signature. Core assembles *data* only: the
 * typed-data payload is a plain value in the exact shape viem's
 * `signTypedData` consumes, so hashing and key custody stay behind the port,
 * in the signer adapter (#41). No key material and no crypto dependency
 * exist in this package.
 *
 * The struct shape, the type string and the domain are frozen contract-side
 * (`OrderHash.sol`, `EIP712("Mayarin PaymentRouter", "1")`) and mirrored
 * here field-for-field; `IPaymentRouter` documents the field order as a
 * public contract. `@mayarin/contracts` (PR #35) exports the same shape for
 * the adapter side — core mirrors instead of importing it so the domain
 * package stays free of the ABI package's viem dependency. The round-trip
 * against #24's test vectors (signature recovers to the quote-signer
 * address contract-side) lands with the signer adapter once #35 merges.
 */

import { ValidationError } from "@mayarin/shared";
import { isExpired, type LockedQuote } from "./lock.ts";

/** A `0x`-prefixed hex string — the wire shape of hashes, addresses, signatures. */
export type Hex = `0x${string}`;

/**
 * Mirror of `IPaymentRouter.Order`. Field order MUST match the contract's
 * EIP-712 typehash exactly; changing either side without the other breaks
 * signature verification. All amounts are raw minor units.
 */
export interface Order {
  /** Backend-issued, globally unique per intent (bytes32). */
  readonly intentId: Hex;
  /** Hard-locked settlement-asset amount (minor units). */
  readonly minOut: bigint;
  /** Treasury take (minor units); the lock guarantees `fee < minOut`. */
  readonly fee: bigint;
  /** Receives `minOut − fee`. */
  readonly merchantSafe: Hex;
  /** Receives `output − minOut` (execution excess). */
  readonly refundTo: Hex;
  /** Order TTL in unix seconds; on-chain `block.timestamp` must be `<= deadline`. */
  readonly deadline: bigint;
}

export const ORDER_DOMAIN_NAME = "Mayarin PaymentRouter";
export const ORDER_DOMAIN_VERSION = "1";

/** The EIP-712 field list, in the contract's frozen order. */
export const ORDER_TYPES = {
  Order: [
    { name: "intentId", type: "bytes32" },
    { name: "minOut", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "merchantSafe", type: "address" },
    { name: "refundTo", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** The primary type string, byte-for-byte the `ORDER_TYPE` in `OrderHash.sol`. */
export const ORDER_TYPE_STRING =
  "Order(bytes32 intentId,uint256 minOut,uint256 fee,address merchantSafe,address refundTo,uint256 deadline)";

/** Derives the type string from `ORDER_TYPES`, so a test can pin both to each other. */
export function orderTypeString(): string {
  const fields = ORDER_TYPES.Order.map((field) => `${field.type} ${field.name}`).join(",");
  return `Order(${fields})`;
}

/** The per-deployment half of the EIP-712 domain; name and version are fixed. */
export interface OrderDomain {
  readonly chainId: bigint;
  /** The deployed `PaymentRouter` address. */
  readonly verifyingContract: Hex;
}

/** The full typed-data payload, in the shape viem's `signTypedData` consumes. */
export interface OrderTypedData {
  readonly domain: {
    readonly name: typeof ORDER_DOMAIN_NAME;
    readonly version: typeof ORDER_DOMAIN_VERSION;
    readonly chainId: bigint;
    readonly verifyingContract: Hex;
  };
  readonly types: typeof ORDER_TYPES;
  readonly primaryType: "Order";
  readonly message: Order;
}

export function orderTypedData(domain: OrderDomain, order: Order): OrderTypedData {
  return {
    domain: {
      name: ORDER_DOMAIN_NAME,
      version: ORDER_DOMAIN_VERSION,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  };
}

/** The intent-side inputs of an order — everything the lock does not carry. */
export interface OrderContext {
  /** Backend-issued bytes32 intent id. */
  readonly intentId: Hex;
  readonly merchantSafe: Hex;
  readonly refundTo: Hex;
}

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Assembles the order the signer signs. `now` comes from the caller's
 * injected `Clock`: an expired lock must not become an order, with the same
 * inclusive `now ≤ deadline` comparison the lock and the contract make. The
 * on-chain deadline is the lock deadline in whole seconds, floored — the
 * conservative direction, never honouring the order past the lock.
 *
 * Address checksums are the adapter's judgement (viem rejects a bad one at
 * signing); core checks shape only.
 */
export function assembleOrder(lock: LockedQuote, context: OrderContext, now: Date): Order {
  if (isExpired(lock, now)) {
    throw new ValidationError("An expired lock cannot become an order", {
      deadline: lock.deadline.toISOString(),
      now: now.toISOString(),
    });
  }
  if (!BYTES32_PATTERN.test(context.intentId)) {
    throw new ValidationError("The intent id must be a 32-byte hex string", {
      intentId: context.intentId,
    });
  }
  if (!ADDRESS_PATTERN.test(context.merchantSafe)) {
    throw new ValidationError("The merchant Safe must be a 20-byte hex address", {
      merchantSafe: context.merchantSafe,
    });
  }
  if (!ADDRESS_PATTERN.test(context.refundTo)) {
    throw new ValidationError("The refund address must be a 20-byte hex address", {
      refundTo: context.refundTo,
    });
  }

  return {
    intentId: context.intentId,
    minOut: lock.minOut.amount,
    fee: lock.fee.amount,
    merchantSafe: context.merchantSafe,
    refundTo: context.refundTo,
    deadline: BigInt(lock.deadline.getTime()) / 1_000n,
  };
}

/**
 * Order signer port. Key custody, rotation and the actual EIP-712 hashing
 * live behind this seam (#41); core hands over data and receives a
 * signature.
 */
export interface OrderSigner {
  /** The address the contract's quote-signer role must match. */
  address(): Promise<Hex>;
  /** A 65-byte `r‖s‖v` signature over the typed data. */
  sign(typedData: OrderTypedData): Promise<Hex>;
}

/** An order with the signature `PaymentRouter` verifies. */
export interface SignedOrder {
  readonly order: Order;
  readonly signature: Hex;
}

export async function signOrder(
  signer: OrderSigner,
  domain: OrderDomain,
  order: Order,
): Promise<SignedOrder> {
  const signature = await signer.sign(orderTypedData(domain, order));
  return { order, signature };
}
