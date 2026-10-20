/**
 * Conditional settlement (#304): the off-chain half of `EscrowFactory`.
 *
 * The signed PaymentRouter order names an escrow address as its
 * `merchantSafe`. That address is a pure function of the terms — CREATE2 over
 * `keccak256(abi.encode(terms))` — so it is derived here with no key and no
 * network call, the same way a deposit address is.
 *
 * The factory has no constructor arguments and is deployed through the
 * canonical deterministic deployer, so it has one address on every chain it
 * is deployed to (`scripts/DeployEscrowFactory.s.sol`).
 */

import type { ChainId } from "@mayarin/chain";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  type PublicClient,
  parseAbi,
  zeroAddress,
} from "viem";

export const ESCROW_FACTORY = "0xCB6dd0781D36FE95a5ff69248498E48909BB4e1B";

/** `EscrowFactory.INIT_CODE_HASH()` — keccak of `EscrowVault`'s creation code. */
export const ESCROW_VAULT_INIT_CODE_HASH =
  "0x58a2031708a2ba67cb2ff7c005b2e84f308e2ca4b28031ff0859886e71ea75fc";

/**
 * `EscrowFactoryV2` (#315): the dispute bond and split resolution. Same
 * deterministic deployer, its own salt (`scripts/DeployEscrowFactoryV2.s.sol`).
 * Terms carrying a `bond` are v2 terms; terms without one are v1's.
 */
export const ESCROW_FACTORY_V2 = "0xB14EEab74d84F900132632ff9dAcDe26C5043cad";

/** `EscrowFactoryV2.INIT_CODE_HASH()` — keccak of `EscrowVaultV2`'s creation code. */
export const ESCROW_VAULT_V2_INIT_CODE_HASH =
  "0x8e127716e7db0e6c441573aef490ba60d27dffdbe1c8538c8908b760f9e24c5f";

/**
 * How long the arbiter has to decide a dispute once the hold has ended. A
 * dispute still open after it refunds the payer — the card-chargeback default.
 */
export const ESCROW_ARBITRATION_SECONDS = 7 * 24 * 60 * 60;

/** Chains `EscrowFactory` is deployed on. An escrowed payment anywhere else is refused. */
export const ESCROW_CHAINS: readonly ChainId[] = [
  "arbitrum-sepolia",
  "base-sepolia",
  "ethereum-sepolia",
  "arc-testnet",
];

/**
 * Chains `EscrowFactoryV2` is deployed on (#315). A new escrow there is made
 * under v2 — with the merchant's bond, which may be zero — and under v1
 * everywhere else, so v2 rolls out one chain at a time.
 */
export const ESCROW_V2_CHAINS: readonly ChainId[] = [
  "arbitrum-sepolia",
  "base-sepolia",
  "ethereum-sepolia",
  "arc-testnet",
];

export const ESCROW_FACTORY_ABI = parseAbi([
  "function release((bytes32 intentId, address payer, address payee, address arbiter, uint64 releaseAfter, uint64 resolveBy) terms, address token) returns (uint256)",
  "function refund((bytes32 intentId, address payer, address payee, address arbiter, uint64 releaseAfter, uint64 resolveBy) terms, address token) returns (uint256)",
  "function dispute((bytes32 intentId, address payer, address payee, address arbiter, uint64 releaseAfter, uint64 resolveBy) terms)",
  "function disputed(bytes32 salt) view returns (bool)",
  "function outcome(bytes32 salt) view returns (uint8)",
]);

const TERMS_V2 =
  "(bytes32 intentId, address payer, address payee, address arbiter, uint64 releaseAfter, uint64 resolveBy, uint256 bond)";

export const ESCROW_FACTORY_V2_ABI = parseAbi([
  `function release(${TERMS_V2} terms, address token) returns (uint256)`,
  `function refund(${TERMS_V2} terms, address token) returns (uint256)`,
  `function resolve(${TERMS_V2} terms, address token, uint16 payeeBps) returns (uint256, uint256)`,
  `function dispute(${TERMS_V2} terms, address token)`,
]);

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface EscrowTerms {
  readonly intentId: `0x${string}`;
  readonly payer: string;
  readonly payee: string;
  /** `0x000…0` for no arbiter. */
  readonly arbiter: string;
  /** Unix seconds after which an undisputed escrow is releasable by anyone. */
  readonly releaseAfter: bigint;
  /** Unix seconds after which a still-disputed escrow refunds the payer. */
  readonly resolveBy: bigint;
  /**
   * Settlement-token units the payer posts to dispute (#315). Present — even
   * as `0n` — on v2 terms only; absent means a v1 escrow.
   */
  readonly bond?: bigint;
}

/** The factory an escrow under these terms lives at. */
export function escrowFactoryOf(terms: EscrowTerms): string {
  return terms.bond === undefined ? ESCROW_FACTORY : ESCROW_FACTORY_V2;
}

function onChainTerms(terms: EscrowTerms) {
  return {
    intentId: terms.intentId,
    payer: getAddress(terms.payer),
    payee: getAddress(terms.payee),
    arbiter: getAddress(terms.arbiter),
    releaseAfter: terms.releaseAfter,
    resolveBy: terms.resolveBy,
  };
}

/** `EscrowFactory.saltOf(terms)`, or `EscrowFactoryV2.saltOf(terms)` for v2 terms. */
export function escrowSalt(terms: EscrowTerms): `0x${string}` {
  const t = onChainTerms(terms);
  const v1 = [
    { type: "bytes32" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "uint64" },
    { type: "uint64" },
  ] as const;
  const values = [t.intentId, t.payer, t.payee, t.arbiter, t.releaseAfter, t.resolveBy] as const;
  return keccak256(
    terms.bond === undefined
      ? encodeAbiParameters(v1, values)
      : encodeAbiParameters([...v1, { type: "uint256" }], [...values, terms.bond]),
  );
}

/** `escrowAddress(terms)` on the factory these terms belong to. */
export function escrowAddress(
  terms: EscrowTerms,
  factory: string = escrowFactoryOf(terms),
): string {
  return getCreate2Address({
    from: getAddress(factory),
    salt: escrowSalt(terms),
    bytecodeHash:
      terms.bond === undefined ? ESCROW_VAULT_INIT_CODE_HASH : ESCROW_VAULT_V2_INIT_CODE_HASH,
  });
}

export function escrowArbiter(arbiter: string | undefined): string {
  return arbiter === undefined ? zeroAddress : getAddress(arbiter);
}

export type EscrowAction = "release" | "refund" | "dispute";

/** Calldata for one escrow action, to be sent to the factory by the party allowed to. */
export function escrowCalldata(
  action: EscrowAction,
  terms: EscrowTerms,
  token: string,
): `0x${string}` {
  const t = onChainTerms(terms);
  if (terms.bond !== undefined) {
    return encodeFunctionData({
      abi: ESCROW_FACTORY_V2_ABI,
      functionName: action,
      args: [{ ...t, bond: terms.bond }, getAddress(token)],
    });
  }
  return action === "dispute"
    ? encodeFunctionData({ abi: ESCROW_FACTORY_ABI, functionName: "dispute", args: [t] })
    : encodeFunctionData({
        abi: ESCROW_FACTORY_ABI,
        functionName: action,
        args: [t, getAddress(token)],
      });
}

/**
 * The arbiter's split of a disputed v2 escrow (#315): `payeeBps` of the
 * payment to the payee, the rest to the payer; the bond follows the majority.
 */
export function escrowResolveCalldata(
  terms: EscrowTerms,
  token: string,
  payeeBps: number,
): `0x${string}` {
  if (terms.bond === undefined) throw new Error("A v1 escrow cannot be split");
  if (!Number.isInteger(payeeBps) || payeeBps < 0 || payeeBps > 10_000) {
    throw new Error("payeeBps is a whole number from 0 to 10000");
  }
  return encodeFunctionData({
    abi: ESCROW_FACTORY_V2_ABI,
    functionName: "resolve",
    args: [{ ...onChainTerms(terms), bond: terms.bond }, getAddress(token), payeeBps],
  });
}

/** The payer's approval of the bond to the factory, sent to the token before disputing. */
export function escrowBondApproveCalldata(terms: EscrowTerms): `0x${string}` {
  return encodeFunctionData({
    abi: ERC20_BALANCE_ABI,
    functionName: "approve",
    args: [getAddress(escrowFactoryOf(terms)), terms.bond ?? 0n],
  });
}

/** `split` only under v2 (#315): the arbiter divided the payment. */
export type EscrowOutcome = "held" | "released" | "refunded" | "split";

export interface EscrowState {
  readonly outcome: EscrowOutcome;
  readonly disputed: boolean;
  /** What the escrow holds now, in the settlement token's minor units. */
  readonly balance: bigint;
}

const OUTCOMES: readonly EscrowOutcome[] = ["held", "released", "refunded", "split"];

/** Reads an escrow's state in three calls; no log scan. */
export async function readEscrowState(
  client: PublicClient,
  terms: EscrowTerms,
  token: string,
  factory: string = escrowFactoryOf(terms),
): Promise<EscrowState> {
  const salt = escrowSalt(terms);
  const address = getAddress(factory);
  const [outcome, disputed, balance] = await Promise.all([
    client.readContract({
      address,
      abi: ESCROW_FACTORY_ABI,
      functionName: "outcome",
      args: [salt],
    }),
    client.readContract({
      address,
      abi: ESCROW_FACTORY_ABI,
      functionName: "disputed",
      args: [salt],
    }),
    client.readContract({
      address: getAddress(token),
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [getAddress(escrowAddress(terms, factory))],
    }),
  ]);
  return { outcome: OUTCOMES[outcome] ?? "held", disputed, balance };
}
