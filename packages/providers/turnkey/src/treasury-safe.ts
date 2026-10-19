/**
 * The treasury as a threshold Safe (SEC-06).
 *
 * Fees and swap output land at `TREASURY_ADDRESS`. A single key there is a single
 * point of compromise, so it should be a Safe that needs several independent
 * people to move anything. This deploys one, deterministically, on the canonical
 * Safe 1.4.1 contracts, and checks on chain that it ended up owned by exactly who
 * was asked for: the transaction succeeding is not the same thing.
 *
 * The owners are people's keys (hardware wallets). Never the operator, and never
 * a key a service holds: a signer set that includes the hot key is only as safe
 * as the hot key.
 */

import { ConfigurationError } from "@mayarin/shared";
import {
  type Address,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  type Hex,
  keccak256,
  type PublicClient,
  pad,
  parseAbi,
  toHex,
  type WalletClient,
} from "viem";
import { SAFE_1_4_1, type SafeDeployment } from "./wallet-provider.ts";

const FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() pure returns (bytes)",
]);
const SAFE_ABI = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface TreasurySafeRequest {
  /** The people's keys that control the treasury. */
  readonly owners: readonly string[];
  /** Approvals needed to move anything. */
  readonly threshold: number;
  /** Names this Safe: the same owners and threshold with another salt is another Safe. */
  readonly salt: string;
  /** Addresses that must not be an owner, e.g. the operator's. */
  readonly forbiddenOwners?: readonly string[];
}

export interface TreasurySafe {
  readonly address: Address;
  readonly owners: readonly Address[];
  readonly threshold: number;
}

/** The request, checked and normalised. Throws on anything that is not a multisig. */
export function validateTreasurySafe(request: TreasurySafeRequest): TreasurySafe & {
  readonly salt: bigint;
} {
  const owners = request.owners.map((owner) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner) || /^0x0{40}$/.test(owner)) {
      throw new ConfigurationError("An owner is not an address", { owner });
    }
    return getAddress(owner);
  });
  if (new Set(owners).size !== owners.length) {
    throw new ConfigurationError("An owner is listed twice", {});
  }
  if (request.threshold < 2) {
    throw new ConfigurationError(
      "The threshold must be at least 2: a 1-of-N Safe is one key with extra steps",
      { threshold: request.threshold },
    );
  }
  if (request.threshold > owners.length) {
    throw new ConfigurationError("The threshold is higher than the number of owners", {
      threshold: request.threshold,
      owners: owners.length,
    });
  }
  const forbidden = new Set((request.forbiddenOwners ?? []).map((a) => a.toLowerCase()));
  for (const owner of owners) {
    if (forbidden.has(owner.toLowerCase())) {
      throw new ConfigurationError("A key a service holds cannot be an owner of the treasury", {
        owner,
      });
    }
  }
  if (request.salt.trim() === "") throw new ConfigurationError("A salt is required", {});
  return {
    address: ZERO,
    owners,
    threshold: request.threshold,
    salt: BigInt(keccak256(toHex(`mayarin:treasury:${request.salt}`))),
  };
}

function initializer(
  owners: readonly Address[],
  threshold: number,
  deployment: SafeDeployment,
): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "setup",
    args: [
      owners as Address[],
      BigInt(threshold),
      ZERO,
      "0x",
      deployment.fallbackHandler,
      ZERO,
      0n,
      ZERO,
    ],
  });
}

/** The three Safe contracts must be the canonical ones on this chain before anything is derived. */
async function assertCanonical(client: PublicClient, deployment: SafeDeployment): Promise<void> {
  for (const name of ["proxyFactory", "singleton", "fallbackHandler"] as const) {
    const code = await client.getCode({ address: deployment[name] });
    if (code === undefined || keccak256(code) !== deployment.codeHashes[name]) {
      throw new ConfigurationError(`The Safe ${name} on this chain is not the canonical one`, {
        address: deployment[name],
      });
    }
  }
}

/** Where the Safe will be, whether or not it exists yet. */
export async function predictTreasurySafe(
  client: PublicClient,
  request: TreasurySafeRequest,
  deployment: SafeDeployment = SAFE_1_4_1,
): Promise<TreasurySafe> {
  const { owners, threshold, salt } = validateTreasurySafe(request);
  await assertCanonical(client, deployment);
  const creationCode = await client.readContract({
    address: deployment.proxyFactory,
    abi: FACTORY_ABI,
    functionName: "proxyCreationCode",
  });
  const saltHash = keccak256(
    concatHex([
      keccak256(initializer(owners, threshold, deployment)),
      pad(toHex(salt), { size: 32 }),
    ]),
  );
  const bytecode = concatHex([
    creationCode,
    encodeAbiParameters([{ type: "address" }], [deployment.singleton]),
  ]);
  const address = getContractAddress({
    opcode: "CREATE2",
    from: deployment.proxyFactory,
    salt: saltHash,
    bytecodeHash: keccak256(bytecode),
  });
  return { address, owners, threshold };
}

/**
 * Deploys the Safe, or confirms the one already there, then reads it back.
 * Idempotent: the address is deterministic, so "already deployed" is recognised.
 */
export async function deployTreasurySafe(
  client: PublicClient,
  wallet: WalletClient,
  request: TreasurySafeRequest,
  deployment: SafeDeployment = SAFE_1_4_1,
): Promise<TreasurySafe & { readonly deployed: boolean }> {
  const predicted = await predictTreasurySafe(client, request, deployment);
  const { salt } = validateTreasurySafe(request);
  let deployed = false;

  const existing = await client.getCode({ address: predicted.address });
  if (existing === undefined || existing === "0x") {
    const account = wallet.account;
    if (account === undefined)
      throw new ConfigurationError("The deploying wallet has no account", {});
    const args = [
      deployment.singleton,
      initializer(predicted.owners, predicted.threshold, deployment),
      salt,
    ] as const;
    await client.simulateContract({
      account,
      address: deployment.proxyFactory,
      abi: FACTORY_ABI,
      functionName: "createProxyWithNonce",
      args,
    });
    const hash = await wallet.writeContract({
      account,
      chain: wallet.chain,
      address: deployment.proxyFactory,
      abi: FACTORY_ABI,
      functionName: "createProxyWithNonce",
      args,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new ConfigurationError("Safe deployment reverted", { hash });
    }
    deployed = true;
  }

  // Whoever the transaction says it made, the custody claim is what is on chain.
  const [owners, threshold] = await Promise.all([
    client.readContract({ address: predicted.address, abi: SAFE_ABI, functionName: "getOwners" }),
    client.readContract({
      address: predicted.address,
      abi: SAFE_ABI,
      functionName: "getThreshold",
    }),
  ]);
  const sameOwners =
    owners.length === predicted.owners.length &&
    predicted.owners.every((owner) => owners.some((o) => o.toLowerCase() === owner.toLowerCase()));
  if (!sameOwners || Number(threshold) !== predicted.threshold) {
    throw new ConfigurationError(
      "The Safe on chain does not have the requested owners and threshold",
      {
        address: predicted.address,
        owners,
        threshold: Number(threshold),
      },
    );
  }
  return { ...predicted, deployed };
}
