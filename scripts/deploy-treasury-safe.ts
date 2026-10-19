/**
 * Deploys the treasury as a threshold Safe (SEC-06).
 *
 *   # Predict the address and check the chain. Sends nothing.
 *   bun --env-file=.env run scripts/deploy-treasury-safe.ts --chain base-sepolia \
 *     --owner 0x… --owner 0x… --owner 0x… --threshold 2 --salt treasury-1
 *
 *   # Deploy it. Needs SAFE_DEPLOYER_PRIVATE_KEY, any funded key; it has no
 *   # authority over the Safe once it exists.
 *   … --execute
 *
 * `--rpc <url>` overrides the chain's configured RPC, e.g. a local fork.
 *
 * The owners are people's keys. The script refuses the operator's address and
 * any address of a key this environment holds, and a threshold under 2. After a
 * deploy it reads the owners and threshold back from the chain and fails if they
 * are not exactly what was asked for. Afterwards: set `TREASURY_ADDRESS` to the
 * printed address, and move any balance from the old treasury.
 */

import { evmChainIdOf, isEvmChainId } from "@mayarin/chain";
import { deployTreasurySafe, predictTreasurySafe } from "@mayarin/provider-turnkey";
import { createPublicClient, createWalletClient, defineChain, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function args(name: string): string[] {
  return process.argv.flatMap((value, i) =>
    value === `--${name}` && process.argv[i + 1] !== undefined
      ? [process.argv[i + 1] as string]
      : [],
  );
}
const one = (name: string): string | undefined => args(name)[0];

const chain = one("chain");
if (chain === undefined || !isEvmChainId(chain)) throw new Error("--chain <evm chain> is required");
const rpcUrl =
  one("rpc") ?? (JSON.parse(process.env.CHAIN_RPC_URLS ?? "{}") as Record<string, string>)[chain];
if (rpcUrl === undefined)
  throw new Error(`No RPC URL for ${chain}: set CHAIN_RPC_URLS or pass --rpc`);

// Keys this environment holds: none of them may own the treasury.
const forbiddenOwners: string[] = [];
for (const name of [
  "OPERATOR_PRIVATE_KEY",
  "QUOTE_SIGNER_PRIVATE_KEY",
  "SAFE_DEPLOYER_PRIVATE_KEY",
]) {
  const key = process.env[name];
  if (key !== undefined && key !== "")
    forbiddenOwners.push(privateKeyToAccount(key as Hex).address);
}
for (const name of ["OPERATOR_ADDRESS", "TURNKEY_SIGNER_ADDRESS", "QUOTE_SIGNER_ADDRESS"]) {
  const address = process.env[name];
  if (address !== undefined && address !== "") forbiddenOwners.push(address);
}

const request = {
  owners: args("owner"),
  threshold: Number(one("threshold")),
  salt: one("salt") ?? "",
  forbiddenOwners,
};

const definition = defineChain({
  id: Number(evmChainIdOf(chain)),
  name: chain,
  nativeCurrency: { name: "native", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain: definition, transport: http(rpcUrl) });

if (!process.argv.includes("--execute")) {
  const safe = await predictTreasurySafe(client, request);
  const code = await client.getCode({ address: safe.address });
  console.log(`chain       ${chain}`);
  console.log(`address     ${safe.address}`);
  console.log(`owners      ${safe.owners.join(", ")}`);
  console.log(`threshold   ${safe.threshold} of ${safe.owners.length}`);
  console.log(`deployed    ${code === undefined || code === "0x" ? "no" : "yes"}`);
  console.log("\nSends nothing. Add --execute to deploy.");
} else {
  const key = process.env.SAFE_DEPLOYER_PRIVATE_KEY;
  if (key === undefined || key === "") throw new Error("SAFE_DEPLOYER_PRIVATE_KEY is not set");
  const wallet = createWalletClient({
    account: privateKeyToAccount(key as Hex),
    chain: definition,
    transport: http(rpcUrl),
  });
  const safe = await deployTreasurySafe(client, wallet, request);
  console.log(`${safe.deployed ? "deployed" : "already deployed"}  ${safe.address}`);
  console.log(`owners      ${safe.owners.join(", ")}`);
  console.log(`threshold   ${safe.threshold} of ${safe.owners.length}  (read back from the chain)`);
  console.log(`\nSet TREASURY_ADDRESS=${safe.address} for ${chain}.`);
}
