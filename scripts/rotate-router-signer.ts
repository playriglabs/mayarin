/**
 * Rotates the `PaymentRouter` order signer through the timelock (#41).
 *
 * `setSigner` is `onlyRole(CONFIG_ROLE)`, and `CONFIG_ROLE` lives on the
 * external `TimelockController` — so this is two operations, `schedule` then
 * `execute`, separated by the timelock's minimum delay. Base Sepolia runs a
 * delay of 0, so both land in one run there; mainnet keeps 48h and this script
 * will tell you when to come back.
 *
 * Why it matters that this happens *before* `QUOTE_SIGNER=turnkey`: the router
 * stores the address it accepts orders from. Flip the environment first and
 * every contract-path payment is signed by an address the contract rejects, and
 * fails at submit — silently, from the payer's point of view.
 *
 *   bun --env-file=.env run scripts/rotate-router-signer.ts --to 0x…
 *   bun --env-file=.env run scripts/rotate-router-signer.ts --to 0x… --execute
 *
 * Without `--execute` it reads state and prints the plan, sending nothing.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ROUTER_ABI = [
  {
    type: "function",
    name: "signer",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setSigner",
    inputs: [{ name: "newSigner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
] as const;

const TIMELOCK_ABI = [
  {
    type: "function",
    name: "getMinDelay",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "PROPOSER_ROLE",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "EXECUTOR_ROLE",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isOperationReady",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isOperationDone",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hashOperation",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "bytes" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "schedule",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "bytes" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      { type: "address" },
      { type: "uint256" },
      { type: "bytes" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const newSigner = flagValue("--to") as Hex | undefined;

if (newSigner === undefined || !/^0x[0-9a-fA-F]{40}$/.test(newSigner)) {
  console.error("usage: --to 0x<address> [--execute]");
  process.exit(1);
}

const router = requireAddress(
  JSON.parse(requireEnv("PAYMENT_ROUTERS"))["base-sepolia"],
  "PAYMENT_ROUTERS[base-sepolia]",
);
const timelock = requireAddress(
  process.env.TIMELOCK_ADDRESS ?? "0x0c006FC14063e3F78271312B975231e4BD6e8B00",
  "TIMELOCK_ADDRESS",
);
const rpcUrl = JSON.parse(requireEnv("CHAIN_RPC_URLS"))["base-sepolia"];
const account = privateKeyToAccount(requireEnv("OPERATOR_PRIVATE_KEY") as Hex);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

// `salt` is derived from the target signer, so re-running names the same
// operation: a repeat cannot queue a second identical rotation, and a
// half-finished run can be resumed rather than duplicated.
const salt = `0x${newSigner.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
const callData = encodeFunctionData({
  abi: ROUTER_ABI,
  functionName: "setSigner",
  args: [newSigner],
});

// Computed rather than read: the router declares CONFIG_ROLE `internal`, so
// there is no getter — and the value is a hash of a constant string anyway.
const configRole = keccak256(toBytes("CONFIG_ROLE"));

const [currentSigner, minDelay] = await Promise.all([
  publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: "signer" }),
  publicClient.readContract({ address: timelock, abi: TIMELOCK_ABI, functionName: "getMinDelay" }),
]);

const [timelockHasConfig, proposerRole, executorRole] = await Promise.all([
  publicClient.readContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: "hasRole",
    args: [configRole, timelock],
  }),
  publicClient.readContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: "PROPOSER_ROLE",
  }),
  publicClient.readContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: "EXECUTOR_ROLE",
  }),
]);

const [canPropose, canExecute] = await Promise.all([
  publicClient.readContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: "hasRole",
    args: [proposerRole, account.address],
  }),
  publicClient.readContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: "hasRole",
    args: [executorRole, account.address],
  }),
]);

const operationId = await publicClient.readContract({
  address: timelock,
  abi: TIMELOCK_ABI,
  functionName: "hashOperation",
  args: [router, 0n, callData, `0x${"0".repeat(64)}` as Hex, salt],
});

const [ready, done] = await Promise.all([
  publicClient.readContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: "isOperationReady",
    args: [operationId],
  }),
  publicClient.readContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: "isOperationDone",
    args: [operationId],
  }),
]);

console.log(`router          ${router}`);
console.log(`timelock        ${timelock}  (CONFIG_ROLE: ${timelockHasConfig ? "yes" : "NO"})`);
console.log(
  `operator        ${account.address}  (proposer: ${canPropose}, executor: ${canExecute})`,
);
console.log(`min delay       ${minDelay}s`);
console.log(`current signer  ${currentSigner}`);
console.log(`new signer      ${newSigner}`);
console.log(`operation       ${operationId}  (ready: ${ready}, done: ${done})`);

if (currentSigner.toLowerCase() === newSigner.toLowerCase()) {
  console.log("\nAlready the current signer. Nothing to do.");
  process.exit(0);
}
if (!timelockHasConfig) {
  console.error(
    "\nThe timelock does not hold CONFIG_ROLE on this router; rotation cannot go through it.",
  );
  process.exit(1);
}
if (!canPropose || !canExecute) {
  console.error("\nThe operator key is not both proposer and executor on this timelock.");
  process.exit(1);
}

if (!execute) {
  console.log("\nDry run. Re-run with --execute to schedule and (once ready) execute.");
  process.exit(0);
}

if (!done && !ready) {
  console.log("\nscheduling…");
  const hash = await walletClient.writeContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: "schedule",
    args: [router, 0n, callData, `0x${"0".repeat(64)}` as Hex, salt, minDelay],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`schedule reverted: ${hash}`);
    process.exit(1);
  }
  console.log(`scheduled  ${hash}`);
}

const readyNow = await publicClient.readContract({
  address: timelock,
  abi: TIMELOCK_ABI,
  functionName: "isOperationReady",
  args: [operationId],
});

if (!readyNow && !done) {
  console.log(`\nQueued. Executable after the ${minDelay}s delay — re-run with --execute then.`);
  process.exit(0);
}

let executedAt: bigint | undefined;
if (!done) {
  console.log("executing…");
  const hash = await walletClient.writeContract({
    address: timelock,
    abi: TIMELOCK_ABI,
    functionName: "execute",
    args: [router, 0n, callData, `0x${"0".repeat(64)}` as Hex, salt],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // A reverted transaction still produces a receipt, so the status is the
  // thing to check — awaiting one proves inclusion, not success.
  if (receipt.status !== "success") {
    console.error(`execute reverted: ${hash}`);
    process.exit(1);
  }
  executedAt = receipt.blockNumber;
  console.log(`executed   ${hash}`);
}

// Read it back at the block the execution landed in, not at `latest`.
//
// Reading `latest` here raced a load-balanced RPC and reported a rotation that
// had in fact succeeded as a MISMATCH: the receipt proves the write, but the
// next `eth_call` can be served by a node that has not caught up. Pinning the
// block removes the race rather than papering over it with a retry.
const after = await publicClient.readContract({
  address: router,
  abi: ROUTER_ABI,
  functionName: "signer",
  ...(executedAt === undefined ? {} : { blockNumber: executedAt }),
});
console.log(`\nsigner is now ${after}`);
if (after.toLowerCase() !== newSigner.toLowerCase()) {
  console.error("MISMATCH — the rotation did not take effect.");
  process.exit(1);
}
console.log("\nNow update .env: QUOTE_SIGNER=turnkey, set TURNKEY_SIGN_WITH and");
console.log("TURNKEY_SIGNER_ADDRESS, and delete QUOTE_SIGNER_PRIVATE_KEY.");

function flagValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

function requireAddress(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    console.error(`${label} is not an address`);
    process.exit(1);
  }
  return value as Hex;
}
