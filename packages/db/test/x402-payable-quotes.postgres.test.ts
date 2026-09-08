/**
 * Postgres integration tests for the x402 payable quote lock (#273).
 *
 * The in-memory fake cannot prove the one property this table exists for:
 * that two agents racing one obligation serialize, with exactly one nonce
 * winning the claim. Only a real database executing the conditional `UPDATE`
 * under concurrency shows that, so it is tested here and nowhere else.
 *
 * Requires a migrated database:
 *
 * ```
 * bun run db:up && bun run db:migrate
 * TEST_DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin_test bun test packages/db
 * ```
 *
 * Skipped when `TEST_DATABASE_URL` is not set. This suite truncates the table
 * it touches, so it must never key on `DATABASE_URL` (#110).
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import type { PayableQuote } from "@mayarin/x402";
import { USDC_BASE_SEPOLIA } from "@mayarin/x402/testing";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/client.ts";
import { DrizzlePayableQuoteRepository } from "../src/repositories/x402-payable-quotes.ts";
import { guardedTestDatabaseUrl } from "./database-guard.ts";

const TEST_DATABASE_URL = guardedTestDatabaseUrl(process.env);

const SECOND = 1000;

describe.skipIf(TEST_DATABASE_URL === undefined)("Drizzle payable quotes", () => {
  const handle = createDatabase({ url: TEST_DATABASE_URL as string, maxConnections: 8 });
  const repository = new DrizzlePayableQuoteRepository(handle.db);

  async function truncateAll(): Promise<void> {
    await handle.db.execute(sql`truncate table x402_payable_quotes restart identity cascade`);
  }

  beforeEach(truncateAll);

  afterAll(async () => {
    await truncateAll();
    await handle.close();
  });

  function aQuote(now: Date, expiresInSeconds = 60): PayableQuote {
    return {
      kind: "invoice",
      obligationId: "inv_race",
      merchantId: "mrc_quotes",
      amount: money(1_500n, "IDR"),
      accepts: [USDC_BASE_SEPOLIA],
      expiresAt: new Date(now.getTime() + expiresInSeconds * SECOND),
      status: "quoted",
      createdAt: now,
      updatedAt: now,
    };
  }

  test("concurrent claims on one obligation: exactly one wins", async () => {
    const now = new Date();
    await repository.save(aQuote(now), { now });

    const attempts = await Promise.all(
      ["nonce-a", "nonce-b", "nonce-c"].map((nonce) =>
        repository.claim("invoice", "inv_race", nonce, new Date(now.getTime() + SECOND)),
      ),
    );

    const winners = attempts.filter((result) => result.ok);
    expect(winners).toHaveLength(1);

    const refusals = attempts.filter((result) => !result.ok);
    expect(refusals).toHaveLength(2);
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false);
      if (!refusal.ok) expect(refusal.reason).toBe("claimed-by-other");
    }

    // The stored claim is the winner's nonce, and a find agrees with it.
    const stored = await repository.find("invoice", "inv_race");
    expect(stored?.status).toBe("claimed");
    expect(stored?.claimedNonce).toBe((winners[0] as { quote: PayableQuote }).quote.claimedNonce);
  });

  test("the same nonce resumes even past expiry", async () => {
    const now = new Date();
    await repository.save(aQuote(now), { now });

    const first = await repository.claim(
      "invoice",
      "inv_race",
      "nonce-a",
      new Date(now.getTime() + SECOND),
    );
    expect(first.ok).toBe(true);

    // The nonce is already spent on-chain; a retry after the quote expired must
    // still pass, or the payment is unrecoverable.
    const late = new Date(now.getTime() + 120 * SECOND);
    const resume = await repository.claim("invoice", "inv_race", "nonce-a", late);
    expect(resume.ok).toBe(true);
  });

  test("a different nonce past expiry is refused as expired, not claimed-by-other", async () => {
    const now = new Date();
    await repository.save(aQuote(now), { now });
    await repository.claim("invoice", "inv_race", "nonce-a", new Date(now.getTime() + SECOND));

    const late = new Date(now.getTime() + 120 * SECOND);
    const result = await repository.claim("invoice", "inv_race", "nonce-b", late);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  test("a refresh does not clobber a live claim", async () => {
    const now = new Date();
    await repository.save(aQuote(now), { now });
    await repository.claim("invoice", "inv_race", "nonce-a", new Date(now.getTime() + SECOND));

    const later = new Date(now.getTime() + 10 * SECOND);
    await repository.save({ ...aQuote(later), amount: money(2_000n, "IDR") }, { now: later });

    const stored = await repository.find("invoice", "inv_race");
    expect(stored?.status).toBe("claimed");
    expect(stored?.claimedNonce).toBe("nonce-a");
    expect(stored?.amount).toStrictEqual(money(1_500n, "IDR"));
  });

  test("a refresh resets an expired claim and a settled quote", async () => {
    const now = new Date();
    await repository.save(aQuote(now), { now });
    await repository.claim("invoice", "inv_race", "nonce-a", new Date(now.getTime() + SECOND));

    // The claim lapsed with the quote: the next refresh resets the row.
    const later = new Date(now.getTime() + 120 * SECOND);
    await repository.save({ ...aQuote(later), amount: money(2_000n, "IDR") }, { now: later });
    const refreshed = await repository.find("invoice", "inv_race");
    expect(refreshed?.status).toBe("quoted");
    expect(refreshed?.claimedNonce).toBeUndefined();
    expect(refreshed?.amount).toStrictEqual(money(2_000n, "IDR"));

    // A settled quote is likewise re-quotable: the obligation can be paid again.
    await repository.claim("invoice", "inv_race", "nonce-b", new Date(later.getTime() + SECOND));
    await repository.markSettled("invoice", "inv_race", new Date(later.getTime() + 2 * SECOND));
    const settled = await repository.find("invoice", "inv_race");
    expect(settled?.status).toBe("settled");

    const again = new Date(later.getTime() + 3 * SECOND);
    await repository.save(aQuote(again), { now: again });
    const reset = await repository.find("invoice", "inv_race");
    expect(reset?.status).toBe("quoted");
    expect(reset?.claimedNonce).toBeUndefined();
  });

  test("claiming an obligation with no quote is missing", async () => {
    const result = await repository.claim("link", "lnk_nowhere", "nonce-a", new Date());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing");
  });
});
