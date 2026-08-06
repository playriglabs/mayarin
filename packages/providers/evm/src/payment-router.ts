/**
 * PaymentRouter call builder (RFC #5 — #49).
 *
 * Turns a signed order (#40) plus an executable swap route into the transaction
 * that `PaymentRouter` runs. Encoding needs an ABI encoder, so this is an
 * adapter, not domain logic: it lives beside the other viem-bound EVM code and
 * `packages/core/execution` stays free of viem, the same split the quote package
 * already makes.
 *
 * The ABI and the `Order` shape come from `@mayarin/contracts`; nothing here
 * re-declares them, so a contract change surfaces as a type error rather than a
 * silently wrong selector.
 *
 * **Where the route comes from.** A `SwapRouteSource` (#57): the venue
 * adapters produce the exact-output `ExecutableRoute`, and this module
 * consumes that port type directly — one route shape across the codebase.
 * Freshness (`expiresAt`) stays the submitter's check, because encoding is
 * pure and has no clock.
 */

import { type Order, paymentRouterAbi } from "@mayarin/contracts";
import type { ExecutableRoute } from "@mayarin/execution";
import { ValidationError } from "@mayarin/shared";
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  keccak256,
  stringToBytes,
  zeroAddress,
} from "viem";

/**
 * Derives the order's bytes32 `intentId` from the clearing transaction id.
 * Deterministic on purpose: one payment, one `intentId` — a re-lock after a
 * crash signs the same id, and the contract's idempotency (`intentId`
 * consumed on success) keys on the same value the backend can re-derive.
 */
export function deriveIntentId(clearingTransactionId: string): Hex {
  return keccak256(stringToBytes(clearingTransactionId));
}

/** A transaction ready to submit — everything except gas, nonce and chain. */
export interface RouterCall {
  readonly to: Address;
  readonly data: Hex;
  /** Native value to attach. Zero on the ERC-20 paths. */
  readonly value: bigint;
}

/** The payer's Permit2 authorisation, as `IPermit2.PermitSingle`. */
export interface Permit2Single {
  readonly token: Address;
  /** Max the router may pull, and what it does pull. `uint160`. */
  readonly amount: bigint;
  /** Allowance expiration. `uint48`. */
  readonly expiration: number;
  /** Single-use; Permit2 rejects reuse. Read it from Permit2, never assume 0. */
  readonly nonce: number;
  /** Must be the PaymentRouter address or `transferFrom` reverts. */
  readonly spender: Address;
  /** Signature deadline, distinct from the allowance expiration. `uint256`. */
  readonly sigDeadline: bigint;
}

/** `abi.encode(PermitSingle, bytes)` — the `permitData` argument of `payERC20`. */
const PERMIT_DATA_PARAMS = [
  {
    type: "tuple",
    components: [
      {
        type: "tuple",
        name: "details",
        components: [
          { type: "address", name: "token" },
          { type: "uint160", name: "amount" },
          { type: "uint48", name: "expiration" },
          { type: "uint48", name: "nonce" },
        ],
      },
      { type: "address", name: "spender" },
      { type: "uint256", name: "sigDeadline" },
    ],
  },
  { type: "bytes" },
] as const;

/**
 * Packs a `PermitSingle` and the payer's signature the way `payERC20` decodes
 * them. The contract does `abi.decode(permitData, (PermitSingle, bytes))`, so
 * the tuple layout here has to match `IPermit2.PermitSingle` field for field.
 */
export function encodePermitData(permit: Permit2Single, signature: Hex): Hex {
  return encodeAbiParameters(PERMIT_DATA_PARAMS, [
    {
      details: {
        token: permit.token,
        amount: permit.amount,
        expiration: permit.expiration,
        nonce: permit.nonce,
      },
      spender: permit.spender,
      sigDeadline: permit.sigDeadline,
    },
    signature,
  ]);
}

/**
 * Builds `payEth(order, signature, router, data)`.
 *
 * Native input always differs from the ERC-20 settlement asset, so a route is
 * mandatory — the contract rejects a zero router or empty calldata with
 * `NoRoute`. `value` is the payer's native amount, which the contract forwards
 * to the route in full.
 */
export function buildPayEthCall(args: {
  readonly paymentRouter: Address;
  readonly order: Order;
  readonly signature: Hex;
  readonly route: ExecutableRoute;
  readonly value: bigint;
}): RouterCall {
  const router = requireRoute(args.route);
  if (args.value <= 0n) {
    throw new ValidationError("payEth needs a positive native value", {
      value: args.value.toString(),
    });
  }
  return {
    to: args.paymentRouter,
    data: encodeFunctionData({
      abi: paymentRouterAbi,
      functionName: "payEth",
      args: [args.order, args.signature, router, args.route.callData],
    }),
    value: args.value,
  };
}

/**
 * Builds `payERC20(order, permitData, signature, router, data)`.
 *
 * Omit `route` for the same-asset path: when the payer's asset is the settlement
 * asset the contract skips the router entirely, and passing a route would be a
 * lie about what happens. Cross-asset requires one.
 *
 * The caller must have read `permit.nonce` from Permit2 — `payERC20` calls
 * `permit()` unconditionally, so a stale nonce reverts the whole payment.
 */
export function buildPayERC20Call(args: {
  readonly paymentRouter: Address;
  readonly order: Order;
  readonly signature: Hex;
  readonly permit: Permit2Single;
  readonly permitSignature: Hex;
  readonly route?: ExecutableRoute;
}): RouterCall {
  if (args.permit.spender !== args.paymentRouter) {
    throw new ValidationError("The permit spender must be the PaymentRouter", {
      spender: args.permit.spender,
      paymentRouter: args.paymentRouter,
    });
  }
  const router = args.route ? requireRoute(args.route) : zeroAddress;
  return {
    to: args.paymentRouter,
    data: encodeFunctionData({
      abi: paymentRouterAbi,
      functionName: "payERC20",
      args: [
        args.order,
        encodePermitData(args.permit, args.permitSignature),
        args.signature,
        router,
        args.route?.callData ?? "0x",
      ],
    }),
    value: 0n,
  };
}

/**
 * Mirrors the contract's `NoRoute` check, so a bad route fails before it
 * costs gas, and returns the checksummed router address the encoder needs —
 * the port carries `router` as a plain string.
 */
function requireRoute(route: ExecutableRoute): Address {
  let router: Address;
  try {
    router = getAddress(route.router);
  } catch (error) {
    throw new ValidationError(
      "The route router is not a valid address",
      { router: route.router },
      { cause: error },
    );
  }
  if (router === zeroAddress || route.callData === "0x") {
    throw new ValidationError("A cross-asset payment needs a router and swap calldata", {
      router: route.router,
      callDataLength: route.callData.length,
    });
  }
  return router;
}
