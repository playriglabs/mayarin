/**
 * Invoicing application service.
 *
 * Owns the document lifecycle and nothing else. Payment is minted through the
 * commerce layer's own checkout, so no second path to a Payment Intent exists —
 * one code path prices lines and creates intents, whether a cashier rings up a
 * cart, a buyer opens a link, or a finance team pays a tagihan.
 *
 * Effects arrive as ports: a repository, a number allocator, the checkout seam
 * and a reader for the intents already raised against an invoice. Time arrives
 * through `Clock`. Nothing here calls `Date.now()`.
 */

import type { CheckoutCartCommand } from "@mayarin/catalog";
import type { PaymentIntent } from "@mayarin/payment-intent";
import {
  type Clock,
  IdempotencyConflictError,
  type Money,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import { viewOf } from "./balance.ts";
import {
  assertInvoicePayable,
  type CreateInvoiceInput,
  createInvoice,
  type EditInvoiceInput,
  editInvoice,
  issueInvoice,
  listInvoice,
  unlistInvoice,
  voidInvoice,
} from "./invoice.ts";
import { formatInvoiceNumber, type InvoiceNumberFormat } from "./number.ts";
import type {
  InvoiceRepository,
  ListInvoicesOptions,
  ListListedInvoicesOptions,
} from "./repository.ts";
import type { Invoice, InvoiceView } from "./types.ts";

/**
 * The seam onto checkout.
 *
 * Structural rather than a class reference, matching how the commerce layer
 * names its own `IntentMinter`: this package depends on the shape it calls and
 * not on how a deployment assembles it. `CheckoutService` satisfies it, and so
 * does a test double.
 */
export interface InvoiceCheckout {
  checkoutCart(command: CheckoutCartCommand): Promise<PaymentIntent>;
}

/**
 * The seam onto intents already raised against an invoice.
 *
 * `PaymentIntentRepository` satisfies this. The lookup is by merchant reference
 * because that is where an invoice number lives on an intent, and the composite
 * index on `(merchant_id, merchant_reference)` already backs exactly this query.
 */
export interface InvoicePaymentReader {
  list(options: {
    readonly merchantId: string;
    readonly merchantReference: string;
  }): Promise<readonly PaymentIntent[]>;
}

export interface InvoiceServiceOptions {
  readonly invoices: InvoiceRepository;
  readonly checkout: InvoiceCheckout;
  readonly payments: InvoicePaymentReader;
  readonly clock: Clock;
}

export type CreateInvoiceCommand = Omit<CreateInvoiceInput, "now">;

export interface IssueInvoiceCommand {
  readonly dueAt: Date;
  readonly format?: InvoiceNumberFormat;
}

export interface CheckoutInvoiceCommand
  extends Pick<CheckoutCartCommand, "payment" | "executionPath"> {
  /** Defaults to the outstanding balance. Never more than it. */
  readonly amount?: Money;
}

/** Metadata key an intent carries so a payment can be traced back to its document. */
export const INVOICE_METADATA_KEY = "invoiceId";

export class InvoiceService {
  readonly #invoices: InvoiceRepository;
  readonly #checkout: InvoiceCheckout;
  readonly #payments: InvoicePaymentReader;
  readonly #clock: Clock;

  constructor(options: InvoiceServiceOptions) {
    this.#invoices = options.invoices;
    this.#checkout = options.checkout;
    this.#payments = options.payments;
    this.#clock = options.clock;
  }

  async createInvoice(command: CreateInvoiceCommand): Promise<Invoice> {
    if (command.idempotencyKey !== undefined) {
      const existing = await this.#invoices.findByIdempotencyKey(command.idempotencyKey);
      if (existing !== null) {
        if (existing.merchantId !== command.merchantId) {
          throw new IdempotencyConflictError(
            "This idempotency key belongs to another merchant's invoice",
            { idempotencyKey: command.idempotencyKey },
          );
        }
        return existing;
      }
    }

    const invoice = createInvoice({ ...command, now: this.#clock.now() });
    await this.#invoices.insert(invoice);
    return invoice;
  }

  async getInvoice(id: string): Promise<Invoice> {
    return this.#require(id);
  }

  /** The invoice plus every figure derived from the payments raised against it. */
  async viewInvoice(id: string): Promise<InvoiceView> {
    const invoice = await this.#require(id);
    const intents = await this.#intentsFor(invoice);
    return { invoice, ...viewOf(invoice, intents, this.#clock.now()) };
  }

  async listInvoices(options: ListInvoicesOptions): Promise<readonly Invoice[]> {
    return this.#invoices.list(options);
  }

  /** Edits a draft. An issued invoice refuses, which is the freeze rule. */
  async editInvoice(id: string, input: EditInvoiceInput): Promise<Invoice> {
    const invoice = await this.#require(id);
    const next = editInvoice(invoice, input, this.#clock.now());
    await this.#invoices.update(next, invoice.version);
    return next;
  }

  /**
   * Issues a draft under the merchant's next number.
   *
   * Allocation and the write are one call, not two, because gapless numbering
   * requires them to be one transaction. The service hands the adapter a pure
   * function from a sequence to an issued invoice and lets the adapter decide
   * when to run it.
   */
  async issueInvoice(id: string, command: IssueInvoiceCommand): Promise<Invoice> {
    const invoice = await this.#require(id);
    const now = this.#clock.now();

    return this.#invoices.issue(invoice, (sequence) =>
      issueInvoice(invoice, {
        number: formatInvoiceNumber(sequence, now, command.format),
        sequence,
        dueAt: command.dueAt,
        now,
      }),
    );
  }

  async voidInvoice(id: string): Promise<Invoice> {
    const invoice = await this.#require(id);
    const next = voidInvoice(invoice, this.#clock.now());
    if (next === invoice) return invoice;
    await this.#invoices.update(next, invoice.version);
    return next;
  }

  /** Lists an invoice in the public x402 payable index (#273). See `listInvoice`. */
  async listInvoice(id: string): Promise<Invoice> {
    const invoice = await this.#require(id);
    const next = listInvoice(invoice, this.#clock.now());
    if (next === invoice) return invoice;
    await this.#invoices.update(next, invoice.version);
    return next;
  }

  /** Withdraws an invoice from the index. Payability is untouched. */
  async unlistInvoice(id: string): Promise<Invoice> {
    const invoice = await this.#require(id);
    const next = unlistInvoice(invoice, this.#clock.now());
    if (next === invoice) return invoice;
    await this.#invoices.update(next, invoice.version);
    return next;
  }

  /**
   * The listed invoices, newest first — the merchant rows behind the public
   * x402 payable index. Which of them a discovery reader is shown is decided
   * by the caller: this returns every listed invoice, and payability (draft,
   * void, already paid) is a read-time fact this layer does not re-derive.
   */
  async listListedInvoices(options: ListListedInvoicesOptions): Promise<readonly Invoice[]> {
    return this.#invoices.listListed(options);
  }

  /**
   * Mints a Payment Intent against an issued invoice.
   *
   * Defaults to the outstanding balance, so a buyer returning to settle the
   * rest is never billed the whole invoice a second time. A caller may ask for
   * less, which is how a buyer pays in instalments; asking for more than is
   * owed is refused rather than accepted as a tip.
   *
   * Lines are passed with the prices the invoice froze, never as product
   * references. Re-resolving them from the catalog would let the amount move
   * between issue and payment, which is the one thing a document with a number
   * on it must not do.
   *
   * A part payment cannot honestly be described by the invoice's line items —
   * it is not a subset of them — so it mints one balance line naming the
   * invoice instead. A first payment for the full amount keeps the real lines,
   * because there the snapshot is a true receipt.
   */
  async checkoutInvoice(id: string, command: CheckoutInvoiceCommand = {}): Promise<PaymentIntent> {
    const invoice = await this.#require(id);
    assertInvoicePayable(invoice);

    const intents = await this.#intentsFor(invoice);
    const { paid, outstanding } = viewOf(invoice, intents, this.#clock.now());
    if (outstanding.amount === 0n) {
      throw new ValidationError(`Invoice ${invoice.id} is already paid in full`, {
        id: invoice.id,
        number: invoice.number,
      });
    }

    const requested = command.amount ?? outstanding;
    if (requested.asset !== invoice.currency) {
      throw new ValidationError(
        `Invoice ${invoice.id} is priced in ${invoice.currency}, not ${requested.asset}`,
        { id: invoice.id, currency: invoice.currency, requested: requested.asset },
      );
    }
    if (requested.amount <= 0n) {
      throw new ValidationError("A payment against an invoice must be greater than zero", {
        id: invoice.id,
        requested: requested.amount.toString(),
      });
    }
    if (requested.amount > outstanding.amount) {
      throw new ValidationError(`Invoice ${invoice.id} has less than that outstanding`, {
        id: invoice.id,
        outstanding: outstanding.amount.toString(),
        requested: requested.amount.toString(),
      });
    }

    const whole = paid.amount === 0n && requested.amount === invoice.total.amount;
    const lines = whole
      ? invoice.lines.map((line) => ({
          name: line.name,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
        }))
      : [{ name: `Invoice ${invoice.number}`, unitPrice: requested, quantity: 1 }];

    return this.#checkout.checkoutCart({
      merchant: invoice.merchant,
      currency: invoice.currency,
      lines,
      ...(command.payment === undefined ? {} : { payment: command.payment }),
      ...(command.executionPath === undefined ? {} : { executionPath: command.executionPath }),
      ...(invoice.number === undefined ? {} : { merchantReference: invoice.number }),
      metadata: { ...invoice.metadata, [INVOICE_METADATA_KEY]: invoice.id },
    });
  }

  /**
   * An invoice with no number has never been issued, so nothing can have been
   * paid against it. Skipping the query is not an optimisation — a blank
   * reference would match every intent that carries none.
   */
  async #intentsFor(invoice: Invoice): Promise<readonly PaymentIntent[]> {
    if (invoice.number === undefined) return [];
    return this.#payments.list({
      merchantId: invoice.merchantId,
      merchantReference: invoice.number,
    });
  }

  async #require(id: string): Promise<Invoice> {
    const invoice = await this.#invoices.findById(id);
    if (invoice === null) throw new NotFoundError(`Invoice ${id} not found`, { id });
    return invoice;
  }
}
