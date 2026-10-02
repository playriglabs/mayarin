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

export const ESCROW_FACTORY = "0x545a2C8DD1fc765c61ea5dc2105427Be89c24A45";

/** `EscrowFactory.INIT_CODE_HASH()` — keccak of `EscrowVault`'s creation code. */
export const ESCROW_VAULT_INIT_CODE_HASH =
  "0x670f4e5d0d7a9aae5bef60b138a4473f8006ec857ae11dd2f908bdd9e2238e72";

/**
 * How long the arbiter has to decide a dispute once the hold has ended. A
 * dispute still open after it refunds the payer — the card-chargeback default.
 */
export const ESCROW_ARBITRATION_SECONDS = 7 * 24 * 60 * 60;

/** Chains `EscrowFactory` is deployed on. An escrowed payment anywhere else is refused. */
export const ESCROW_CHAINS: readonly ChainId[] = ["arbitrum-sepolia", "robinhood-testnet"];

export const ESCROW_FACTORY_ABI = parseAbi([
  "function release((bytes32 intentId, address payer, address payee, address arbiter, uint64 releaseAfter, uint64 resolveBy) terms, address token) returns (uint256)",
  "function refund((bytes32 intentId, address payer, address payee, address arbiter, uint64 releaseAfter, uint64 resolveBy) terms, address token) returns (uint256)",
  "function dispute((bytes32 intentId, address payer, address payee, address arbiter, uint64 releaseAfter, uint64 resolveBy) terms)",
  "function disputed(bytes32 salt) view returns (bool)",
  "function outcome(bytes32 salt) view returns (uint8)",
]);

const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

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

/** `EscrowFactory.saltOf(terms)`. */
export function escrowSalt(terms: EscrowTerms): `0x${string}` {
  const t = onChainTerms(terms);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint64" },
        { type: "uint64" },
      ],
      [t.intentId, t.payer, t.payee, t.arbiter, t.releaseAfter, t.resolveBy],
    ),
  );
}

/** `EscrowFactory.escrowAddress(terms)`. */
export function escrowAddress(terms: EscrowTerms, factory: string = ESCROW_FACTORY): string {
  return getCreate2Address({
    from: getAddress(factory),
    salt: escrowSalt(terms),
    bytecodeHash: ESCROW_VAULT_INIT_CODE_HASH,
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
  return action === "dispute"
    ? encodeFunctionData({ abi: ESCROW_FACTORY_ABI, functionName: "dispute", args: [t] })
    : encodeFunctionData({
        abi: ESCROW_FACTORY_ABI,
        functionName: action,
        args: [t, getAddress(token)],
      });
}

export type EscrowOutcome = "held" | "released" | "refunded";

export interface EscrowState {
  readonly outcome: EscrowOutcome;
  readonly disputed: boolean;
  /** What the escrow holds now, in the settlement token's minor units. */
  readonly balance: bigint;
}

const OUTCOMES: readonly EscrowOutcome[] = ["held", "released", "refunded"];

/** Reads an escrow's state in three calls; no log scan. */
export async function readEscrowState(
  client: PublicClient,
  terms: EscrowTerms,
  token: string,
  factory: string = ESCROW_FACTORY,
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
