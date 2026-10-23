/**
 * One-off ledger adjustments for the first mainnet end-to-end payments (22-23 Oct 2026).
 *
 * ```
 * docker exec aws-core-api-1 bun scripts/ledger-adjust-mainnet-e2e.ts            # print, change nothing
 * docker exec aws-core-api-1 bun scripts/ledger-adjust-mainnet-e2e.ts --execute  # post
 * ```
 *
 * Three postings, each balanced and keyed so running this twice posts once:
 *
 * 1. The four treasury-executed payments settled as `Dr SETTLEMENT_IN_FLIGHT / Cr MERCHANT_HOLDING`,
 *    but PaymentRouter had already paid the merchant Safe on-chain. Treasury never held that
 *    value. Dr MERCHANT_HOLDING / Cr TREASURY removes both; what is left in TREASURY is the fee
 *    and the FX result, which is what the corrected engine books for a new payment.
 * 2. The failed Polygon USDT payment: the operator sent its 1.114212 USDT to the merchant Safe
 *    (0x1bcd9272…feb88). The payer's asset is gone and the obligation to the payer is discharged.
 * 3. The failed BNB payment: the 0.00053518 BNB was returned to the payer.
 */

import { createDatabase, DrizzleLedgerRepository } from "@mayarin/db";
import { credit, type DraftTransaction, debit, LedgerService } from "@mayarin/ledger";
import { money, systemClock } from "@mayarin/shared";

const execute = process.argv.includes("--execute");
const REFERENCE = "adjustment:mainnet-e2e-2026-10-22";

const adjustments: readonly DraftTransaction[] = [
  {
    description:
      "Correct treasury-executed settlements: the router paid the merchant Safe on-chain, so no merchant balance is owed and treasury never held it",
    reference: REFERENCE,
    idempotencyKey: `${REFERENCE}:merchant-holding`,
    entries: [
      debit("MERCHANT_HOLDING", money(3_562_127n, "USDC")),
      credit("TREASURY", money(3_562_127n, "USDC")),
    ],
  },
  {
    description:
      "Failed Polygon USDT payment: the operator delivered the payer's USDT to the merchant Safe (tx 0x1bcd927210ee6fd768e2a42c1d94cf3fba2b3641fca6e5b3c349c0beb03feb88)",
    reference: REFERENCE,
    idempotencyKey: `${REFERENCE}:usdt`,
    entries: [
      debit("PAYER_ASSET_OBLIGATION", money(1_114_212n, "USDT")),
      credit("PAYER_ASSET_HELD", money(1_114_212n, "USDT")),
    ],
  },
  {
    description:
      "Failed BNB payment pi_01M5K4789S5ANNY7XGS6YZM1R4: the deposit was returned to the payer",
    reference: REFERENCE,
    idempotencyKey: `${REFERENCE}:bnb`,
    entries: [
      debit("PAYER_ASSET_OBLIGATION", money(535_180_000_000_000n, "BNB")),
      credit("PAYER_ASSET_HELD", money(535_180_000_000_000n, "BNB")),
    ],
  },
];

for (const draft of adjustments) {
  console.log(draft.idempotencyKey, "-", draft.description);
  for (const entry of draft.entries) {
    console.log(`  ${entry.direction.padEnd(6)} ${entry.accountCode} ${entry.amount.amount}`);
  }
}

if (!execute) {
  console.log("\ndry run: nothing posted. Add --execute to post.");
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");

const handle = createDatabase({ url: databaseUrl });
try {
  const ledger = new LedgerService({
    repository: new DrizzleLedgerRepository(handle.db, systemClock),
    clock: systemClock,
  });
  for (const draft of adjustments) {
    const posted = await ledger.post(draft);
    console.log(`posted ${draft.idempotencyKey} as ${posted.id}`);
  }
} finally {
  await handle.close();
}
