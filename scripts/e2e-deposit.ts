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
 * bun run e2e -- --asset USDC --amount 5000 --currency IDR
 *
 * # pay a real merchant created by `bun run seed:merchant`
 * bun run e2e -- --merchant mrc_01K… --settlement-address 0x… --amount 0.25
 * ```
 *
 * `--merchant` names an existing merchant and the run adopts its name,
 * settlement asset and accepted assets — the point being to exercise the
 * merchant a dashboard account actually owns rather than a fixture that only
 * this file knows about. `--seed-merchant` remains the throwaway path.
 *
 * `seed:merchant` leaves the on-chain settlement address blank, because most
 * merchants are created before anyone knows their Safe. The contract pays
 * `merchantSafe` and there is no deployment-wide address to fall back on that
 * would not pay every merchant into the same wallet, so `--settlement-address`
 * fills it in and persists it.
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

import {
  createDatabase,
  DrizzleMerchantRepository,
  DrizzleWatcherCursorRepository,
} from "@mayarin/db";
import {
  merchants as merchantsTable,
  merchantWallets as merchantWalletsTable,
} from "@mayarin/db/schema";
import { generateId, isMayarinError } from "@mayarin/shared";
import { eq } from "drizzle-orm";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../apps/api/src/config.ts";
import { createContainer } from "../apps/api/src/container.ts";

const CHAIN = "base-sepolia" as const;
/** The fixture `--seed-merchant` creates when no `--merchant` is named. */
const FIXTURE_MERCHANT_ID = "ID1020017611473";
const FIXTURE_MERCHANT_NAME = "Warung Kopi Mayarin";
/** Where the fixture merchant is paid. Not a real Safe; testnet only. */
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
/** What the merchant prices in. `USD` is a peg to USDC; `IDR` is a real FX rate. */
const currency = (arg("currency") ?? "USD").toUpperCase();
const price = Number(arg("amount") ?? "0.25");
const seedMerchant = process.argv.includes("--seed-merchant");
const merchantId = arg("merchant") ?? FIXTURE_MERCHANT_ID;
const settlementAddress = arg("settlement-address");

if (settlementAddress !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(settlementAddress)) {
  console.error(`--settlement-address must be a 20-byte hex address, got ${settlementAddress}`);
  process.exit(1);
}

if (asset !== "USDC" && asset !== "ETH") {
  console.error(`--asset must be USDC or ETH, got ${asset}`);
  process.exit(1);
}
if (currency !== "USD" && currency !== "IDR") {
  console.error(`--currency must be USD or IDR, got ${currency}`);
  process.exit(1);
}
if (!Number.isFinite(price) || price <= 0) {
  console.error(`--amount must be a positive number of ${currency}, got ${arg("amount")}`);
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
  // `USD/USDC` is one currency in two representations, so that leg is a decimal
  // rescale. `IDR/USDC` is not — it is a real exchange rate, read from Pyth's
  // `FX.USD/IDR` inverted, and it goes stale like any other.
  QUOTE_PEGGED_PAIRS: '["USD/USDC"]',
  // Start just behind the head: the watcher has no reason to walk history it
  // has already been told about, and a wide first pass is what trips the
  // 10-block `eth_getLogs` cap on a free RPC tier. Only used when no cursor is
  // persisted yet — a stored cursor outranks this, which is why the run also
  // pins the cursor itself before it watches.
  CHAIN_START_BLOCKS: JSON.stringify({ [CHAIN]: (head - 1n).toString() }),
} as Record<string, string | undefined>);

// A dev API on this database is a second clearing engine with its own wiring:
// its watcher races this run for every transition, and #104 records where that
// leads. Any response on the API port means one is up — refuse to run beside it.
const apiListening = await fetch(`http://localhost:${config.port}/health`).then(
  () => true,
  () => false,
);
if (apiListening) {
  console.error(
    `An API is listening on http://localhost:${config.port}.` +
      "\nIt is a second clearing engine on the same database and it will race this run." +
      "\nStop `bun run dev` / `bun run dev:all` first, then run this script again.",
  );
  process.exit(1);
}

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
const priceLabel =
  currency === "IDR" ? `Rp ${price.toLocaleString("id-ID")}` : `$${price.toFixed(2)}`;
console.log(`Deposit path · ${CHAIN} · merchant prices ${priceLabel} · payer sends ${asset}`);
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
let merchant = await merchants.findById(merchantId);

if (merchant === null) {
  if (!seedMerchant) {
    console.error(
      `\nMerchant ${merchantId} does not exist.` +
        "\nCreate one with `bun run seed:merchant` and pass it as --merchant," +
        "\nor re-run with --seed-merchant for a throwaway fixture.",
    );
    process.exit(1);
  }

  const now = new Date();
  await merchantDb.db.insert(merchantsTable).values({
    id: merchantId,
    name: FIXTURE_MERCHANT_NAME,
    createdAt: now,
    updatedAt: now,
    settlementAsset: "USDC",
    acceptedAssets: ["ETH", "USDC"],
    settlementAddress: settlementAddress ?? MERCHANT_SAFE,
    version: 1,
  });
  // The router signer pays only a verified wallet of the merchant (`WalletGuard`),
  // so the fixture address is recorded as linked and verified — on testnet only.
  await merchantDb.db.insert(merchantWalletsTable).values({
    id: generateId("wlt", now.getTime()),
    merchantId,
    chain: CHAIN,
    address: (settlementAddress ?? MERCHANT_SAFE).toLowerCase(),
    provenance: "linked",
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  merchant = await merchants.findById(merchantId);
  console.log("merchant  ", merchantId, "seeded ->", settlementAddress ?? MERCHANT_SAFE);
}

if (merchant === null) {
  console.error(`Merchant ${merchantId} vanished between the insert and the read.`);
  process.exit(1);
}

// `seed:merchant` leaves this blank — most merchants are created before anyone
// knows their Safe. Persisted rather than held for the run: the merchant this
// pays is the same row the dashboard reads, and a settlement address that
// existed only inside a script would be a different merchant in every way that
// matters afterwards.
if (settlementAddress !== undefined && merchant.settlementAddress !== settlementAddress) {
  await merchantDb.db
    .update(merchantsTable)
    .set({ settlementAddress, updatedAt: new Date() })
    .where(eq(merchantsTable.id, merchantId));
  merchant = await merchants.findById(merchantId);
  console.log("merchant  ", merchantId, "settlement address ->", settlementAddress);
}

if (merchant === null || merchant.settlementAddress === undefined) {
  console.error(
    `\nMerchant ${merchantId} has no on-chain settlement address, so PRICE_LOCKED cannot` +
      "\nsign an order — the contract pays merchantSafe and there is no deployment-wide" +
      "\nfallback that would not pay every merchant into the same wallet." +
      "\n\nPass --settlement-address 0x… to set one.",
  );
  process.exit(1);
}

if (!merchant.acceptedAssets.includes(asset)) {
  console.error(
    `\nMerchant ${merchantId} does not accept ${asset}.` +
      `\nIt accepts: ${merchant.acceptedAssets.join(", ")}`,
  );
  process.exit(1);
}

console.log("merchant  ", merchantId, `${merchant.name} -> ${merchant.settlementAddress}`);

// ---------------------------------------------------------------------------
// 1. The merchant raises a payment request
// ---------------------------------------------------------------------------

const intent = await container.intents.create({
  merchant: { id: merchantId, name: merchant.name, city: "Jakarta", countryCode: "ID" },
  // Both are 2-decimal, so minor units are cents / sen.
  amount: { amount: BigInt(Math.round(price * 100)), asset: currency },
  source: { type: "manual" },
  payment: { asset, chain: CHAIN },
  executionPath: "deposit-match",
  idempotencyKey: `e2e-${currency}-${asset}-${Date.now()}`,
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
const payReceipt = await pub.waitForTransactionReceipt({ hash: payHash, confirmations: 2 });
console.log("\n3. payer paid   ", payHash, `block ${payReceipt.blockNumber}`);

// A persisted cursor outranks `CHAIN_START_BLOCKS`, and every previous run of
// this script leaves one at that run's head. Minutes later the chain has moved
// on and a 10-block window walks history at 10 blocks a tick — the deposit is
// thousands of blocks ahead and 15 ticks never reach it, which reads as "the
// watcher never saw the payment". Pin the cursor to the block before the one
// this run just paid into, so the first tick scans exactly it.
await new DrizzleWatcherCursorRepository(merchantDb.db).set(
  CHAIN,
  asset,
  payReceipt.blockNumber - 1n,
);

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
  let tick: string;
  try {
    const result = await watcher.tick(CHAIN, asset);
    tick = `recorded=${result.recorded} confirmed=${result.confirmed} funded=${result.funded}`;
  } catch (error) {
    // A retryable error means the payment is intact and someone else advanced
    // it between our read and our write — a concurrent engine the preflight
    // could not see (#105). The state below tells us where it got to.
    if (!(isMayarinError(error) && error.retryable)) throw error;
    tick = `lost a race (${error.code}) — is another API on this database?`;
  }
  const current = await container.engine.getById(locked.id);
  console.log(`4. watcher #${String(pass).padStart(2)}   ${tick} state=${current.state}`);
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
