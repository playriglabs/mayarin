/**
 * Registers settlement destinations on a PaymentRouter (SEC-06).
 *
 *   # What is registered, and what is not. Sends nothing.
 *   bun --env-file=.env run scripts/register-merchant-safe.ts --chain base-sepolia --from-db
 *   bun --env-file=.env run scripts/register-merchant-safe.ts --chain base-sepolia --safe 0x…
 *
 *   # Register the ones that are not.
 *   … --execute
 *
 * A router with `merchantRegistryEnforced` pays only registered destinations, so a
 * compromised quote signer cannot name its own address. Registering is the
 * registrar's job: a key that is not the quote signer, granted `REGISTRAR_ROLE`
 * through the timelock (`ConfigureMerchantRegistry.s.sol`). Run this for every
 * merchant before enforcement is switched on, and for each new one after.
 *
 * `--from-db` collects every merchant's `settlement_address` and every managed
 * wallet on the chain (DATABASE_URL). `--execute` needs `REGISTRAR_PRIVATE_KEY`.
 * Registering is idempotent: an address already registered is skipped. One that
 * was revoked is reported and left alone, because only the timelock reinstates it.
 */

import { evmChainIdOf, isEvmChainId } from "@mayarin/chain";
import { createDatabase, merchants, merchantWallets } from "@mayarin/db";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ABI = parseAbi([
  "function merchantRegistryEnforced() view returns (bool)",
  "function isMerchantSafeRegistered(address) view returns (bool)",
  "function isMerchantSafeRevoked(address) view returns (bool)",
  "function registerMerchantSafe(address)",
]);

function args(name: string): string[] {
  return process.argv.flatMap((value, i) =>
    value === `--${name}` && process.argv[i + 1] !== undefined
      ? [process.argv[i + 1] as string]
      : [],
  );
}

const chain = args("chain")[0];
if (chain === undefined || !isEvmChainId(chain)) throw new Error("--chain <evm chain> is required");
const rpcUrl =
  args("rpc")[0] ??
  (JSON.parse(process.env.CHAIN_RPC_URLS ?? "{}") as Record<string, string>)[chain];
if (rpcUrl === undefined)
  throw new Error(`No RPC URL for ${chain}: set CHAIN_RPC_URLS or pass --rpc`);
const router = (JSON.parse(process.env.PAYMENT_ROUTERS ?? "{}") as Record<string, string>)[chain];
if (router === undefined) throw new Error(`No PaymentRouter for ${chain} in PAYMENT_ROUTERS`);

const wanted = new Set<string>(args("safe").map((a) => getAddress(a)));
if (process.argv.includes("--from-db")) {
  const url = process.env.DATABASE_URL;
  if (url === undefined) throw new Error("DATABASE_URL is not set");
  const handle = createDatabase({ url, maxConnections: 1 });
  try {
    for (const row of await handle.db
      .select({ address: merchants.settlementAddress })
      .from(merchants)) {
      if (row.address !== null && /^0x[0-9a-fA-F]{40}$/.test(row.address))
        wanted.add(getAddress(row.address));
    }
    for (const row of await handle.db
      .select({ address: merchantWallets.address, chain: merchantWallets.chain })
      .from(merchantWallets)) {
      if (row.chain === chain && /^0x[0-9a-fA-F]{40}$/.test(row.address)) {
        wanted.add(getAddress(row.address));
      }
    }
  } finally {
    await handle.close();
  }
}
if (wanted.size === 0) throw new Error("Nothing to check: pass --safe 0x… and/or --from-db");

const definition = defineChain({
  id: Number(evmChainIdOf(chain)),
  name: chain,
  nativeCurrency: { name: "native", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain: definition, transport: http(rpcUrl) });
const address = router as Address;

const enforced = await client
  .readContract({ address, abi: ABI, functionName: "merchantRegistryEnforced" })
  .catch(() => undefined);
console.log(
  `router ${router} on ${chain}: ` +
    (enforced === undefined
      ? "no registry (an older router)"
      : `enforcement ${enforced ? "ON" : "off"}`),
);
if (enforced === undefined) throw new Error("This router has no destination registry");

const todo: Address[] = [];
for (const safe of [...wanted].sort()) {
  const [registered, revoked] = await Promise.all([
    client.readContract({
      address,
      abi: ABI,
      functionName: "isMerchantSafeRegistered",
      args: [safe],
    }),
    client.readContract({ address, abi: ABI, functionName: "isMerchantSafeRevoked", args: [safe] }),
  ]);
  const state = registered
    ? "registered"
    : revoked
      ? "REVOKED (the timelock reinstates it)"
      : "not registered";
  console.log(`  ${safe}  ${state}`);
  if (!registered && !revoked) todo.push(safe);
}
console.log(
  `\n${todo.length} to register, ${wanted.size - todo.length} already in place or revoked.`,
);

if (process.argv.includes("--execute") && todo.length > 0) {
  const key = process.env.REGISTRAR_PRIVATE_KEY;
  if (key === undefined || key === "") throw new Error("REGISTRAR_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ account, chain: definition, transport: http(rpcUrl) });
  for (const safe of todo) {
    const hash = await wallet.writeContract({
      address,
      abi: ABI,
      functionName: "registerMerchantSafe",
      args: [safe],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`registered ${safe}  ${receipt.status}  ${hash}`);
    if (receipt.status !== "success") process.exit(1);
  }
} else if (todo.length > 0) {
  console.log("Sends nothing. Add --execute to register them.");
}
