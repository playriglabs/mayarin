/**
 * End-to-end deposit payment against a real chain.
 *
 * Drives one payment the whole way — intent, price lock, deposit address, the
 * payer paying it, the watcher noticing, the treasury executor converting and
 * settling — and prints what actually moved. No UI, no HTTP: it builds the same
 * container `apps/api` boots, so what it exercises is the production wiring
 * rather than a parallel test harness.
 *
 * ```
 * bun run e2e -- --asset USDC --amount 0.25
 * bun run e2e -- --asset ETH  --amount 0.10 --seed-merchant
 * ```
 *
 * Reads `.env` (Bun loads it) plus the deployment-specific values below. The
 * payer is deliberately its own key: on a real deployment the payer is a
 * customer and the operator is Mayarin, and a script that quietly used one key
 * for both would hide the fee and refund flows behind a net-zero balance.
 *
 * Required beyond a normal API boot:
 *
 *   PAYER_PRIVATE_KEY                 the customer paying. On testnet this may
 *                                     be the operator's key — but then the fee
 *                                     and any refund come back to the payer, so
 *                                     read the balance deltas accordingly.
 *   DEPOSIT_FORWARDERS                deployed DepositForwarderFactory per chain
 *   DEPOSIT_FORWARDER_INIT_CODE_HASH  its INIT_CODE_HASH()
 *   TREASURY_ADDRESS                  receives swap output above minOut
 *   OPERATOR_PRIVATE_KEY              pays gas for the sweep and the router call
 */

import { createDatabase, DrizzleMerchantRepository } from "@mayarin/db";
import { merchants as merchantsTable } from "@mayarin/db/schema";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../apps/api/src/config.ts";
import { createContainer } from "../apps/api/src/container.ts";

const CHAIN = "base-sepolia" as const;
const MERCHANT_ID = "ID1020017611473";
/** Where a seeded test merchant is paid. Not a real Safe; testnet only. */
const MERCHANT_SAFE = "0x1111111111111111111111111111111111111111";

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const asset = (arg("asset") ?? "USDC").toUpperCase();
const priceUsd = Number(arg("amount") ?? "0.25");
const seedMerchant = process.argv.includes("--seed-merchant");

if (asset !== "USDC" && asset !== "ETH") {
  console.error(`--asset must be USDC or ETH, got ${asset}`);
  process.exit(1);
}
if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
  console.error(`--amount must be a positive number of USD, got ${arg("amount")}`);
  process.exit(1);
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`Missing ${name}. See the header of this file for what the script needs.`);
    process.exit(1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Boot the same container the API boots
// ---------------------------------------------------------------------------

const rpcUrl = JSON.parse(required("CHAIN_RPC_URLS"))[CHAIN];
if (rpcUrl === undefined) {
  console.error(`CHAIN_RPC_URLS has no entry for ${CHAIN}`);
  process.exit(1);
}

const pub = createPublicClient({ transport: http(rpcUrl) });
const head = await pub.getBlockNumber();

const config = loadConfig({
  ...process.env,
  TREASURY_EXECUTION_ENABLED: "true",
  // `USD/USDC` is one currency in two representations, so the fiat leg is a
  // decimal rescale rather than a rate that could go stale.
  QUOTE_PEGGED_PAIRS: '["USD/USDC"]',
  // Start just behind the head: the watcher has no reason to walk history it
  // has already been told about, and a wide first pass is what trips the
  // 10-block `eth_getLogs` cap on a free RPC tier.
  CHAIN_START_BLOCKS: JSON.stringify({ [CHAIN]: (head - 1n).toString() }),
} as Record<string, string | undefined>);

const container = createContainer({ config });
container.events.subscribe("*", (event: { type: string; payload: unknown }) => {
  if (event.type.includes("fail")) console.log("   ✗", event.type, JSON.stringify(event.payload));
});

const payer = privateKeyToAccount(required("PAYER_PRIVATE_KEY") as `0x${string}`);
const payerWallet = createWalletClient({ account: payer, transport: http(rpcUrl) });
const operator = privateKeyToAccount(required("OPERATOR_PRIVATE_KEY") as `0x${string}`);

const tokens = JSON.parse(process.env.CHAIN_ASSETS ?? "{}")[CHAIN] ?? {};
const tokenAddress = tokens[asset] as `0x${string}` | undefined;
if (asset !== "ETH" && tokenAddress === undefined) {
  console.error(`CHAIN_ASSETS has no ${asset} address for ${CHAIN}`);
  process.exit(1);
}

const decimals = asset === "ETH" ? 18 : 6;
const show = (raw: bigint) =>
  `${(Number(raw) / 10 ** decimals).toFixed(decimals === 18 ? 9 : 6)} ${asset}`;

async function payerBalance(): Promise<bigint> {
  return tokenAddress === undefined
    ? pub.getBalance({ address: payer.address })
    : pub.readContract({
        address: tokenAddress,
        abi: erc20,
        functionName: "balanceOf",
        args: [payer.address],
      });
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

console.log("=".repeat(70));
console.log(`Deposit path · ${CHAIN} · paying $${priceUsd.toFixed(2)} with ${asset}`);
console.log("=".repeat(70));
console.log("payer     ", payer.address, show(await payerBalance()));
console.log(
  "operator  ",
  operator.address,
  `${Number(await pub.getBalance({ address: operator.address })) / 1e18} ETH (gas)`,
);

// A merchant must exist and carry a settlement address, or `PRICE_LOCKED`
// refuses to sign an order: the contract pays `merchantSafe`, and there is no
// deployment-wide address to fall back to that would not pay every merchant
// into the same wallet.
const merchantDb = createDatabase({ url: config.databaseUrl });
const merchants = new DrizzleMerchantRepository(merchantDb.db);
const existing = await merchants.findById(MERCHANT_ID);

if (existing === null || existing.settlementAddress === undefined) {
  if (!seedMerchant) {
    console.error(
      `\nMerchant ${MERCHANT_ID} ${existing === null ? "does not exist" : "has no settlement address"}.` +
        "\nRe-run with --seed-merchant to create a test merchant, or set one yourself.",
    );
    process.exit(1);
  }

  const now = new Date();
  await merchantDb.db
    .insert(merchantsTable)
    .values({
      id: MERCHANT_ID,
      name: "Warung Kopi Mayarin",
      createdAt: now,
      updatedAt: now,
      settlementAsset: "USDC",
      acceptedAssets: ["ETH", "USDC"],
      settlementAddress: MERCHANT_SAFE,
    })
    .onConflictDoUpdate({
      target: merchantsTable.id,
      set: { settlementAddress: MERCHANT_SAFE, acceptedAssets: ["ETH", "USDC"], updatedAt: now },
    });
  console.log("merchant  ", MERCHANT_ID, "seeded ->", MERCHANT_SAFE);
}

// ---------------------------------------------------------------------------
// 1. The merchant raises a payment request
// ---------------------------------------------------------------------------

const intent = await container.intents.create({
  merchant: { id: MERCHANT_ID, name: "Warung Kopi Mayarin", city: "Jakarta", countryCode: "ID" },
  amount: { amount: BigInt(Math.round(priceUsd * 100)), asset: "USD" },
  source: { type: "manual" },
  payment: { asset, chain: CHAIN },
  executionPath: "deposit-match",
  idempotencyKey: `e2e-${asset}-${Date.now()}`,
});
const confirmed = await container.intents.confirm(intent.id);
console.log("\n1. intent       ", confirmed.id);

// ---------------------------------------------------------------------------
// 2. Price locked, order signed, deposit address issued
// ---------------------------------------------------------------------------

const locked = await container.engine.start(confirmed);
const deposit = locked.deposit;
if (deposit === undefined) {
  console.error("No deposit leg was locked — the rail did not produce an address.");
  process.exit(1);
}

console.log("2. price locked  ", locked.state);
console.log("   settlement    ", locked.settlementAmount?.amount, locked.settlementAsset);
console.log("   fee           ", locked.fee?.amount, locked.settlementAsset);
console.log("   merchant net  ", locked.netAmount?.amount, locked.settlementAsset);
console.log("   merchantSafe  ", locked.contract?.order.merchantSafe);
console.log("   refundTo      ", locked.contract?.order.refundTo);
console.log("   pay exactly   ", show(deposit.amount.amount));
console.log("   to            ", deposit.address, "(no code until the operator sweeps it)");

// ---------------------------------------------------------------------------
// 3. The payer pays — a plain transfer, exactly as a wallet or exchange would
// ---------------------------------------------------------------------------

const fees = { maxFeePerGas: 200_000_000n, maxPriorityFeePerGas: 20_000_000n };
const payHash = await payerWallet.sendTransaction({
  ...(tokenAddress === undefined
    ? { to: deposit.address as `0x${string}`, value: deposit.amount.amount }
    : {
        to: tokenAddress,
        data: encodeFunctionData({
          abi: erc20,
          functionName: "transfer",
          args: [deposit.address as `0x${string}`, deposit.amount.amount],
        }),
      }),
  chain: null,
  // Fetched per send: viem caches a nonce across back-to-back sends, which the
  // RPC then rejects as a replacement.
  nonce: await pub.getTransactionCount({ address: payer.address, blockTag: "pending" }),
  ...fees,
});
await pub.waitForTransactionReceipt({ hash: payHash, confirmations: 2 });
console.log("\n3. payer paid   ", payHash);

// ---------------------------------------------------------------------------
// 4. The watcher notices; the executor converts and settles
// ---------------------------------------------------------------------------

const watcher = container.watchers.get(CHAIN);
if (watcher === undefined) {
  console.error(`No watcher for ${CHAIN} — is CHAIN_ENABLED true?`);
  process.exit(1);
}

let settled = false;
for (let pass = 1; pass <= 15; pass += 1) {
  const result = await watcher.tick(CHAIN, asset);
  const current = await container.engine.getById(locked.id);
  console.log(
    `4. watcher #${String(pass).padStart(2)}   recorded=${result.recorded} confirmed=${result.confirmed} funded=${result.funded} state=${current.state}`,
  );
  if (current.state !== "PAYMENT_PENDING") {
    settled = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2_500));
}

if (!settled) {
  console.error("\nThe deposit never funded the payment. Check the watcher output above.");
  process.exit(1);
}

const final = await container.engine.resume(locked.id);
console.log("\n5. final state  ", final.transaction.state);
console.log("   settlement tx", final.transaction.contract?.txHash ?? "(none)");

// ---------------------------------------------------------------------------
// 6. What moved
// ---------------------------------------------------------------------------

const merchantSafe = final.transaction.contract?.order.merchantSafe as `0x${string}` | undefined;
const settlementToken = final.transaction.contract?.order.settlementToken as
  | `0x${string}`
  | undefined;

console.log(`\n${"=".repeat(70)}`);
if (merchantSafe !== undefined && settlementToken !== undefined) {
  const paid = await pub.readContract({
    address: settlementToken,
    abi: erc20,
    functionName: "balanceOf",
    args: [merchantSafe],
  });
  console.log("merchant balance now", `${Number(paid) / 1e6} ${final.transaction.settlementAsset}`);
}
console.log("payer balance now   ", show(await payerBalance()));
console.log("=".repeat(70));

if (final.transaction.state !== "SUCCESS") {
  console.error(`\nEnded in ${final.transaction.state}, not SUCCESS.`);
  process.exit(1);
}

process.exit(0);
