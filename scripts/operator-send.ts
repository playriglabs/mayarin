/**
 * Sends a token the operator holds to an address, and optionally sweeps a deposit
 * forwarder into the operator first. For funds a payment left behind: a payment that
 * failed after the payer's asset reached a deposit address.
 *
 *   AWS_PROFILE=mayarin bun --env-file=.env.mainnet scripts/operator-send.ts \
 *     <chain> <ASSET> <amount> <to> [--sweep-index N] [--execute]
 *
 * Without `--execute` it prints what it would do and what the operator and the forwarder
 * hold, and signs nothing. `--sweep-index` is the deposit address's derivation index
 * (`deposit_addresses.derivation_index`); the sweep is permissionless and moves the token
 * to the factory's destination, which is the operator.
 *
 * It signs with the operator key outside the chain worker's nonce lock, so run it only
 * while no payment is in flight. `amount` is whole units of the token, as a decimal.
 */

import { isChainId } from "@mayarin/chain";
import { depositSalt } from "@mayarin/provider-evm";
import { viemChainOf } from "@mayarin/provider-viem-chains";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { loadConfig } from "../apps/api/src/config.ts";
import { operatorAccount } from "../apps/api/src/operator-account.ts";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const sweepAt = args.indexOf("--sweep-index");
const sweepIndex = sweepAt === -1 ? undefined : Number(args[sweepAt + 1]);
const positional = args.filter(
  (arg, at) => !arg.startsWith("--") && args[at - 1] !== "--sweep-index",
);
const [chain, asset, amountText, toText] = positional;
if (
  chain === undefined ||
  asset === undefined ||
  amountText === undefined ||
  toText === undefined
) {
  throw new Error(
    "usage: operator-send.ts <chain> <ASSET> <amount> <to> [--sweep-index N] [--execute]",
  );
}
if (!isChainId(chain)) throw new Error(`${chain} is not a chain`);
if (sweepIndex !== undefined && !Number.isInteger(sweepIndex))
  throw new Error("--sweep-index is not an integer");

// The database is never opened here; the config just refuses to load without a URL.
const config = loadConfig({ ...process.env, DATABASE_URL: "postgres://unused" }, "worker");
const rpcUrl = config.chainRpcUrls[chain];
const tokenText =
  config.chainAssets[chain]?.[asset as keyof (typeof config.chainAssets)[typeof chain]];
const factoryText = config.depositForwarders[chain];
if (rpcUrl === undefined) throw new Error(`No RPC URL for ${chain}`);
if (tokenText === undefined) throw new Error(`No ${asset} token address on ${chain}`);
const account = operatorAccount(config);
if (account === undefined) throw new Error("No operator account configured");

const token = getAddress(tokenText) as Address;
const to = getAddress(toText);
const publicClient = createPublicClient({ chain: viemChainOf(chain), transport: http(rpcUrl) });
const decimals = await publicClient.readContract({
  address: token,
  abi: erc20Abi,
  functionName: "decimals",
});
const amount = parseUnits(amountText, decimals);
const balanceOf = (holder: Address) =>
  publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });
const show = (label: string, value: bigint) =>
  console.log(`${label}: ${formatUnits(value, decimals)} ${asset}`);

const operator = account.address;
show("operator holds   ", await balanceOf(operator));
if (sweepIndex !== undefined) {
  if (factoryText === undefined) throw new Error(`No deposit forwarder factory on ${chain}`);
  const salt = depositSalt(sweepIndex);
  const forwarder = (await publicClient.readContract({
    address: getAddress(factoryText),
    abi: parseAbi(["function forwarderAddress(bytes32 salt) view returns (address)"]),
    functionName: "forwarderAddress",
    args: [salt],
  })) as Address;
  console.log(`forwarder        : ${forwarder} (index ${sweepIndex})`);
  show("forwarder holds  ", await balanceOf(forwarder));
}
console.log(`send             : ${amountText} ${asset} to ${to} on ${chain}`);

if (!execute) {
  console.log("dry run: nothing signed. Add --execute to send.");
  process.exit(0);
}

const wallet = createWalletClient({ account, chain: viemChainOf(chain), transport: http(rpcUrl) });

if (sweepIndex !== undefined) {
  const hash = await wallet.writeContract({
    address: getAddress(factoryText ?? ""),
    abi: parseAbi(["function sweepToken(bytes32 salt, address token) returns (address)"]),
    functionName: "sweepToken",
    args: [depositSalt(sweepIndex), token],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`swept            : ${hash}`);
}

const held = await balanceOf(operator);
if (held < amount)
  throw new Error(`operator holds ${formatUnits(held, decimals)}, less than ${amountText}`);
const hash = await wallet.writeContract({
  address: token,
  abi: erc20Abi,
  functionName: "transfer",
  args: [to, amount],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`sent             : ${hash} (${receipt.status})`);
