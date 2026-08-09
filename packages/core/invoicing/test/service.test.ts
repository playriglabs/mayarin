import { describe, expect, test } from "bun:test";
import { CheckoutService } from "@mayarin/catalog";
import { InMemoryPaymentLinkRepository, InMemoryProductRepository } from "@mayarin/catalog/testing";
import { type PaymentIntent, PaymentIntentService } from "@mayarin/payment-intent";
import { InMemoryPaymentIntentRepository } from "@mayarin/payment-intent/testing";
import {
  FixedClock,
  InvalidStateTransitionError,
  money,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import { INVOICE_METADATA_KEY, InvoiceService } from "../src/service.ts";
import { InMemoryInvoiceNumberAllocator, InMemoryInvoiceRepository } from "../testing/index.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const DAY = 86_400_000;

const merchant = { id: "mrc_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };
const other = { ...merchant, id: "mrc_2" };
const buyer = { name: "PT Sumber Rejeki", email: "finance@sumberrejeki.co.id" };

/** Rp 25.000 and Rp 75.000 in minor units. */
const beans = money(2_500_000n, "IDR");
const grinder = money(7_500_000n, "IDR");

function harness() {
  const clock = new FixedClock(NOW);
  const intentRepository = new InMemoryPaymentIntentRepository();
  const intents = new PaymentIntentService({
    repository: intentRepository,
    clock,
    defaults: {
      settlementAsset: "IDRX",
      provider: "mock",
      executionPath: "deposit-match",
      ttlSeconds: 900,
    },
  });
  const checkout = new CheckoutService({
    products: new InMemoryProductRepository(),
    links: new InMemoryPaymentLinkRepository(),
    intents,
    clock,
  });

  const invoices = new InvoiceService({
    invoices: new InMemoryInvoiceRepository(),
    numbers: new InMemoryInvoiceNumberAllocator(),
    checkout,
    payments: intentRepository,
    clock,
  });

  return { clock, intentRepository, invoices };
}

function draft(invoices: InvoiceService, merchantId = merchant.id) {
  return invoices.createInvoice({
    merchantId,
    merchant: merchantId === merchant.id ? merchant : other,
    buyer,
    currency: "IDR",
    lines: [
      { name: "Kopi arabika 1kg", unitPrice: beans, quantity: 2 },
      { name: "Grinder", unitPrice: grinder, quantity: 1 },
    ],
  });
}

/** Drives an intent to COMPLETED, which is the only status the balance counts. */
async function complete(
  repository: InMemoryPaymentIntentRepository,
  intent: PaymentIntent,
): Promise<void> {
  await repository.update(
    { ...intent, status: "COMPLETED", version: intent.version + 1 },
    intent.version,
  );
}

describe("creating an invoice", () => {
  test("totals its lines and starts as an unnumbered draft", async () => {
    const { invoices } = harness();
    const invoice = await draft(invoices);

    expect(invoice.state).toBe("draft");
    expect(invoice.number).toBeUndefined();
    expect(invoice.total).toEqual(money(12_500_000n, "IDR"));
    expect(invoice.version).toBe(1);
  });

  test("refuses an invoice with no buyer name", async () => {
    const { invoices } = harness();
    await expect(
      invoices.createInvoice({
        merchantId: merchant.id,
        merchant,
        buyer: { name: "  " },
        currency: "IDR",
        lines: [{ name: "Kopi", unitPrice: beans, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("replaying an idempotency key returns the first invoice", async () => {
    const { invoices } = harness();
    const first = await invoices.createInvoice({
      merchantId: merchant.id,
      merchant,
      buyer,
      currency: "IDR",
      lines: [{ name: "Kopi", unitPrice: beans, quantity: 1 }],
      idempotencyKey: "key-1",
    });
    const second = await invoices.createInvoice({
      merchantId: merchant.id,
      merchant,
      buyer,
      currency: "IDR",
      lines: [{ name: "Kopi", unitPrice: beans, quantity: 1 }],
      idempotencyKey: "key-1",
    });

    expect(second.id).toBe(first.id);
  });

  test("an unknown invoice is a NotFoundError", async () => {
    const { invoices } = harness();
    await expect(invoices.getInvoice("inv_missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("issuing", () => {
  test("allocates a number, an issue date and a due date", async () => {
    const { clock, invoices } = harness();
    const created = await draft(invoices);
    const issued = await invoices.issueInvoice(created.id, {
      dueAt: new Date(clock.now().getTime() + 30 * DAY),
      format: { prefix: "INV", includeYear: true },
    });

    expect(issued.state).toBe("issued");
    expect(issued.number).toBe("INV/2026/0001");
    expect(issued.sequence).toBe(1);
    expect(issued.issuedAt).toEqual(new Date(NOW));
    expect(issued.version).toBe(2);
  });

  test("numbering is sequential and gapless within a merchant", async () => {
    const { clock, invoices } = harness();
    const dueAt = new Date(clock.now().getTime() + 30 * DAY);

    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const created = await draft(invoices);
      const issued = await invoices.issueInvoice(created.id, { dueAt });
      numbers.push(issued.number ?? "");
    }

    expect(numbers).toEqual(["0001", "0002", "0003"]);
  });

  test("each merchant has its own series", async () => {
    const { clock, invoices } = harness();
    const dueAt = new Date(clock.now().getTime() + 30 * DAY);

    const mine = await invoices.issueInvoice((await draft(invoices)).id, { dueAt });
    const theirs = await invoices.issueInvoice((await draft(invoices, other.id)).id, { dueAt });

    expect(mine.number).toBe("0001");
    expect(theirs.number).toBe("0001");
  });

  test("refuses a due date before the issue date", async () => {
    const { clock, invoices } = harness();
    const created = await draft(invoices);
    await expect(
      invoices.issueInvoice(created.id, { dueAt: new Date(clock.now().getTime() - DAY) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("an issued invoice cannot be issued again", async () => {
    const { clock, invoices } = harness();
    const dueAt = new Date(clock.now().getTime() + 30 * DAY);
    const issued = await invoices.issueInvoice((await draft(invoices)).id, { dueAt });

    await expect(invoices.issueInvoice(issued.id, { dueAt })).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
  });
});

describe("the freeze at issue", () => {
  test("a draft can be edited", async () => {
    const { invoices } = harness();
    const created = await draft(invoices);
    const edited = await invoices.editInvoice(created.id, {
      lines: [{ name: "Kopi arabika 1kg", unitPrice: beans, quantity: 1 }],
    });

    expect(edited.total).toEqual(beans);
    expect(edited.version).toBe(2);
  });

  test("an issued invoice refuses every edit", async () => {
    const { clock, invoices } = harness();
    const issued = await invoices.issueInvoice((await draft(invoices)).id, {
      dueAt: new Date(clock.now().getTime() + 30 * DAY),
    });

    await expect(
      invoices.editInvoice(issued.id, { buyer: { name: "Someone else" } }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});

describe("paying an invoice", () => {
  async function issued() {
    const context = harness();
    const created = await draft(context.invoices);
    const invoice = await context.invoices.issueInvoice(created.id, {
      dueAt: new Date(context.clock.now().getTime() + 30 * DAY),
      format: { prefix: "INV", includeYear: true },
    });
    return { ...context, invoice };
  }

  test("a draft cannot be paid", async () => {
    const { invoices } = harness();
    const created = await draft(invoices);
    await expect(invoices.checkoutInvoice(created.id)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
  });

  test("the intent carries the invoice number and id", async () => {
    const { invoices, invoice } = await issued();
    const intent = await invoices.checkoutInvoice(invoice.id);

    expect(intent.merchantReference).toBe("INV/2026/0001");
    expect(intent.metadata[INVOICE_METADATA_KEY]).toBe(invoice.id);
    expect(intent.amount).toEqual(money(12_500_000n, "IDR"));
  });

  test("a full first payment settles the invoice", async () => {
    const { intentRepository, invoices, invoice } = await issued();
    await complete(intentRepository, await invoices.checkoutInvoice(invoice.id));

    const view = await invoices.viewInvoice(invoice.id);
    expect(view.status).toBe("paid");
    expect(view.outstanding).toEqual(money(0n, "IDR"));
  });

  test("a part payment leaves a correct outstanding balance", async () => {
    const { intentRepository, invoices, invoice } = await issued();
    await complete(
      intentRepository,
      await invoices.checkoutInvoice(invoice.id, { amount: money(5_000_000n, "IDR") }),
    );

    const view = await invoices.viewInvoice(invoice.id);
    expect(view.status).toBe("partially_paid");
    expect(view.paid).toEqual(money(5_000_000n, "IDR"));
    expect(view.outstanding).toEqual(money(7_500_000n, "IDR"));
  });

  test("two part payments across two intents settle it", async () => {
    const { intentRepository, invoices, invoice } = await issued();
    const half = money(6_250_000n, "IDR");

    await complete(intentRepository, await invoices.checkoutInvoice(invoice.id, { amount: half }));
    // The second checkout bills the balance, not the whole invoice again.
    const second = await invoices.checkoutInvoice(invoice.id);
    expect(second.amount).toEqual(half);

    await complete(intentRepository, second);
    const view = await invoices.viewInvoice(invoice.id);
    expect(view.status).toBe("paid");
    expect(view.outstanding).toEqual(money(0n, "IDR"));
  });

  test("refuses a payment larger than the balance", async () => {
    const { invoices, invoice } = await issued();
    await expect(
      invoices.checkoutInvoice(invoice.id, { amount: money(99_000_000n, "IDR") }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("refuses another payment once it is settled", async () => {
    const { intentRepository, invoices, invoice } = await issued();
    await complete(intentRepository, await invoices.checkoutInvoice(invoice.id));

    await expect(invoices.checkoutInvoice(invoice.id)).rejects.toBeInstanceOf(ValidationError);
  });

  test("an incomplete intent does not count as payment", async () => {
    const { invoices, invoice } = await issued();
    await invoices.checkoutInvoice(invoice.id);

    const view = await invoices.viewInvoice(invoice.id);
    expect(view.status).toBe("issued");
    expect(view.paid).toEqual(money(0n, "IDR"));
  });
});

describe("overdue and void", () => {
  test("overdue derives from the clock, not from a stored flag", async () => {
    const { clock, invoices } = harness();
    const invoice = await invoices.issueInvoice((await draft(invoices)).id, {
      dueAt: new Date(clock.now().getTime() + 30 * DAY),
    });

    expect((await invoices.viewInvoice(invoice.id)).status).toBe("issued");

    clock.advance(31 * DAY);
    expect((await invoices.viewInvoice(invoice.id)).status).toBe("overdue");
  });

  test("a settled invoice does not become overdue", async () => {
    const { clock, intentRepository, invoices } = harness();
    const invoice = await invoices.issueInvoice((await draft(invoices)).id, {
      dueAt: new Date(clock.now().getTime() + 30 * DAY),
    });
    await complete(intentRepository, await invoices.checkoutInvoice(invoice.id));

    clock.advance(31 * DAY);
    expect((await invoices.viewInvoice(invoice.id)).status).toBe("paid");
  });

  test("voiding keeps the number and refuses payment", async () => {
    const { clock, invoices } = harness();
    const invoice = await invoices.issueInvoice((await draft(invoices)).id, {
      dueAt: new Date(clock.now().getTime() + 30 * DAY),
    });

    const voided = await invoices.voidInvoice(invoice.id);
    expect(voided.state).toBe("void");
    expect(voided.number).toBe(invoice.number);

    await expect(invoices.checkoutInvoice(invoice.id)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
  });

  test("a voided number is never reallocated", async () => {
    const { clock, invoices } = harness();
    const dueAt = new Date(clock.now().getTime() + 30 * DAY);

    const first = await invoices.issueInvoice((await draft(invoices)).id, { dueAt });
    await invoices.voidInvoice(first.id);
    const second = await invoices.issueInvoice((await draft(invoices)).id, { dueAt });

    expect(first.number).toBe("0001");
    expect(second.number).toBe("0002");
  });
});
