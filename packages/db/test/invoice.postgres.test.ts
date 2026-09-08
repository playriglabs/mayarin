/**
 * Postgres integration tests for invoicing (#112).
 *
 * The in-memory fake cannot prove anything about gapless numbering — it is
 * single-threaded, so it is atomic for free. Only a real database can show
 * that concurrent issuance produces neither a duplicate nor a hole, so that
 * claim is tested here and nowhere else.
 *
 * Requires a migrated database:
 *
 * ```
 * bun run db:up && bun run db:migrate
 * TEST_DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin_test bun test packages/db
 * ```
 *
 * Skipped when `TEST_DATABASE_URL` is not set. This suite truncates the tables
 * it touches, so it must never key on `DATABASE_URL`: bun loads the root `.env`
 * for every test run, and that variable points at the development database
 * (#110).
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { CheckoutService } from "@mayarin/catalog";
import { InMemoryPaymentLinkRepository, InMemoryProductRepository } from "@mayarin/catalog/testing";
import { type Invoice, InvoiceService } from "@mayarin/invoicing";
import { PaymentIntentService } from "@mayarin/payment-intent";
import { ConcurrencyError, FixedClock, money } from "@mayarin/shared";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/client.ts";
import { DrizzleInvoiceRepository } from "../src/repositories/invoice.ts";
import { DrizzlePaymentIntentRepository } from "../src/repositories/payment-intent.ts";
import { guardedTestDatabaseUrl } from "./database-guard.ts";

const TEST_DATABASE_URL = guardedTestDatabaseUrl(process.env);

const merchant = { id: "mrc_inv_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };
const buyer = { name: "PT Sumber Rejeki", email: "finance@sumberrejeki.co.id" };
const DAY = 86_400_000;

describe.skipIf(TEST_DATABASE_URL === undefined)("Drizzle invoicing", () => {
  const handle = createDatabase({ url: TEST_DATABASE_URL as string, maxConnections: 8 });
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");

  const repository = new DrizzleInvoiceRepository(handle.db);
  const intentRepository = new DrizzlePaymentIntentRepository(handle.db);

  const invoices = new InvoiceService({
    invoices: repository,
    checkout: new CheckoutService({
      products: new InMemoryProductRepository(),
      links: new InMemoryPaymentLinkRepository(),
      intents: new PaymentIntentService({
        repository: intentRepository,
        clock,
        defaults: {
          settlementAsset: "USDC",
          provider: "mock",
          executionPath: "deposit-match",
          ttlSeconds: 900,
        },
      }),
      clock,
    }),
    payments: intentRepository,
    clock,
  });

  async function truncateAll(): Promise<void> {
    await handle.db.execute(
      sql`truncate table invoices, invoice_counters, payment_intents restart identity cascade`,
    );
  }

  beforeEach(truncateAll);

  afterAll(async () => {
    await truncateAll();
    await handle.close();
  });

  function draft(merchantId = merchant.id): Promise<Invoice> {
    return invoices.createInvoice({
      merchantId,
      merchant: { ...merchant, id: merchantId },
      buyer,
      currency: "IDR",
      lines: [{ name: "Kopi arabika 1kg", unitPrice: money(2_500_000n, "IDR"), quantity: 2 }],
    });
  }

  const dueAt = new Date(clock.now().getTime() + 30 * DAY);

  test("round-trips every field through Postgres", async () => {
    const created = await draft();
    const issued = await invoices.issueInvoice(created.id, {
      dueAt,
      format: { prefix: "INV", includeYear: true },
    });

    const read = await repository.findById(issued.id);
    expect(read).toEqual(issued);
    expect(read?.total).toEqual(money(5_000_000n, "IDR"));
    expect(read?.number).toBe("INV/2026/0001");
  });

  test("finds an issued invoice by the number a buyer quotes back", async () => {
    const issued = await invoices.issueInvoice((await draft()).id, { dueAt });
    const found = await repository.findByNumber(merchant.id, issued.number ?? "");
    expect(found?.id).toBe(issued.id);
  });

  test("a stale version loses to a concurrent writer", async () => {
    const created = await draft();
    await invoices.editInvoice(created.id, { notes: "first" });

    // `created` still carries version 1, which the first edit already consumed.
    await expect(repository.update({ ...created, notes: "second" }, 1)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  /**
   * The claim the whole design rests on.
   *
   * Twenty issuances for one merchant, all started before any of them
   * finishes. Gapless means the numbers are exactly 1..20 — no repeat, which
   * would be two documents sharing an identity, and no hole, which is what an
   * auditor asks about.
   */
  test("concurrent issuance is gapless and free of duplicates", async () => {
    const drafts = await Promise.all(Array.from({ length: 20 }, () => draft()));

    const issued = await Promise.all(
      drafts.map((invoice) => invoices.issueInvoice(invoice.id, { dueAt })),
    );

    const sequences = issued.map((invoice) => invoice.sequence).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(issued.map((invoice) => invoice.number)).size).toBe(20);
  });

  test("each merchant keeps its own series", async () => {
    const mine = await invoices.issueInvoice((await draft()).id, { dueAt });
    const theirs = await invoices.issueInvoice((await draft("mrc_inv_2")).id, { dueAt });

    expect(mine.sequence).toBe(1);
    expect(theirs.sequence).toBe(1);
  });

  /**
   * A failed write must release the number rather than burn it.
   *
   * The second issuance below loses on the optimistic-locking guard, so its
   * transaction rolls back — and the counter increment rolls back with it,
   * because they are the same transaction. The next successful issuance takes
   * the value the failure gave up. A `nextval` sequence would leave a hole here.
   */
  test("a rolled back issuance does not burn its number", async () => {
    const first = await invoices.issueInvoice((await draft()).id, { dueAt });
    expect(first.sequence).toBe(1);

    const stale = await draft();
    await invoices.editInvoice(stale.id, { notes: "bumps the version" });
    // `stale` is version 1; the edit made it 2, so this issuance must fail.
    await expect(
      repository.issue(stale, () => ({ ...stale, state: "issued" })),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    const next = await invoices.issueInvoice((await draft()).id, { dueAt });
    expect(next.sequence).toBe(2);
  });

  test("the database refuses two invoices sharing a number", async () => {
    const first = await invoices.issueInvoice((await draft()).id, { dueAt });
    const other = await draft();

    await expect(
      repository.update(
        { ...other, state: "issued", number: first.number ?? "", sequence: 99 },
        other.version,
      ),
    ).rejects.toThrow();
  });

  test("many drafts coexist, because a draft holds no number", async () => {
    await Promise.all(Array.from({ length: 5 }, () => draft()));
    const listed = await repository.list({ merchantId: merchant.id, state: "draft" });
    expect(listed).toHaveLength(5);
  });
});
