/**
 * Invoice construction and transitions.
 *
 * Every function here is pure and returns a new invoice with an incremented
 * version. The rule the whole file exists to enforce is the freeze: a draft is
 * editable, an issued invoice is not. An accountant cannot file a document
 * whose number, buyer or total can still change underneath them, so an
 * amendment is a new invoice rather than an edit to an old one.
 *
 * The freeze lands at issue, not at first payment. Waiting for a payment would
 * leave a window where a numbered, sent document was still mutable, which is
 * the exact window that makes a number worthless.
 */

import { priceCart } from "@mayarin/catalog";
import type { MerchantSnapshot } from "@mayarin/payment-intent";
import {
  type AssetCode,
  generateId,
  InvalidStateTransitionError,
  ValidationError,
} from "@mayarin/shared";
import type { BuyerSnapshot, Invoice, InvoiceLine } from "./types.ts";

export interface CreateInvoiceInput {
  readonly merchantId: string;
  readonly merchant: MerchantSnapshot;
  readonly buyer: BuyerSnapshot;
  readonly currency: AssetCode;
  readonly lines: readonly InvoiceLine[];
  readonly notes?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly now: Date;
}

/** What a draft accepts as an edit. Absent fields are left as they are. */
export interface EditInvoiceInput {
  readonly buyer?: BuyerSnapshot;
  readonly lines?: readonly InvoiceLine[];
  readonly notes?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface IssueInvoiceInput {
  readonly number: string;
  readonly sequence: number;
  readonly dueAt: Date;
  readonly now: Date;
}

/**
 * Raises a draft.
 *
 * The total is computed by the commerce layer's own pricer, so an invoice and a
 * cart can never disagree about what a set of lines adds up to. That also
 * inherits its guards: no empty invoice, no mixed currencies, no non-positive
 * unit price, no absurd quantity.
 */
export function createInvoice(input: CreateInvoiceInput): Invoice {
  assertBuyer(input.buyer);
  const total = priceCart(input.lines, input.currency);
  const createdAt = new Date(input.now);

  return {
    id: generateId("inv", createdAt.getTime()),
    merchantId: input.merchantId,
    merchant: input.merchant,
    state: "draft",
    buyer: input.buyer,
    currency: input.currency,
    lines: total.lines,
    total: total.total,
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    metadata: input.metadata ?? {},
    listed: false,
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    createdAt,
    updatedAt: createdAt,
    version: 1,
  };
}

/** Edits a draft. Refuses anything else — see the freeze rule above. */
export function editInvoice(invoice: Invoice, input: EditInvoiceInput, now: Date): Invoice {
  assertDraft(invoice, "edited");
  if (input.buyer !== undefined) assertBuyer(input.buyer);

  const lines = input.lines ?? invoice.lines;
  const total = priceCart(lines, invoice.currency);

  return {
    ...invoice,
    buyer: input.buyer ?? invoice.buyer,
    lines: total.lines,
    total: total.total,
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    metadata: input.metadata ?? invoice.metadata,
    updatedAt: new Date(now),
    version: invoice.version + 1,
  };
}

/**
 * Issues a draft under an allocated number.
 *
 * The number arrives from outside rather than being computed here, because
 * allocating one is the single part of invoicing that cannot be pure: it has to
 * agree with every other issuance for the same merchant. See
 * `InvoiceNumberAllocator`.
 */
export function issueInvoice(invoice: Invoice, input: IssueInvoiceInput): Invoice {
  assertDraft(invoice, "issued");

  const issuedAt = new Date(input.now);
  if (input.dueAt.getTime() < issuedAt.getTime()) {
    throw new ValidationError("An invoice cannot fall due before it is issued", {
      id: invoice.id,
      dueAt: input.dueAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
    });
  }

  return {
    ...invoice,
    state: "issued",
    number: input.number,
    sequence: input.sequence,
    issuedAt,
    dueAt: new Date(input.dueAt),
    updatedAt: issuedAt,
    version: invoice.version + 1,
  };
}

/**
 * Voids an invoice.
 *
 * The number is not released. A gap in a sequence is a question an auditor can
 * answer; a reused number is one nobody can.
 */
export function voidInvoice(invoice: Invoice, now: Date): Invoice {
  if (invoice.state === "void") return invoice;

  return {
    ...invoice,
    state: "void",
    voidedAt: new Date(now),
    updatedAt: new Date(now),
    version: invoice.version + 1,
  };
}

/**
 * Lists an invoice in the public x402 payable index (#273).
 *
 * Settable in any state, because the read layer already owns which states a
 * discovery reader is shown — refusing here would invent state that filter
 * expresses, and a voided invoice that a merchant unlists has done nothing a
 * reader could see.
 */
export function listInvoice(invoice: Invoice, now: Date): Invoice {
  if (invoice.listed) return invoice;
  return { ...invoice, listed: true, updatedAt: new Date(now), version: invoice.version + 1 };
}

/** Withdraws an invoice from the public index. Payability is untouched. */
export function unlistInvoice(invoice: Invoice, now: Date): Invoice {
  if (!invoice.listed) return invoice;
  return { ...invoice, listed: false, updatedAt: new Date(now), version: invoice.version + 1 };
}

/** Whether another Payment Intent may be minted against this invoice. */
export function isInvoicePayable(invoice: Invoice): boolean {
  return invoice.state === "issued";
}

/**
 * Refuses to mint an intent from an invoice that is not payable.
 *
 * Enforced in the domain and not only on the hosted page, because the hosted
 * page is not the only caller.
 */
export function assertInvoicePayable(invoice: Invoice): void {
  if (invoice.state === "draft") {
    throw new InvalidStateTransitionError(`Invoice ${invoice.id} is a draft and cannot be paid`, {
      id: invoice.id,
      state: invoice.state,
    });
  }
  if (invoice.state === "void") {
    throw new InvalidStateTransitionError(`Invoice ${invoice.id} has been voided`, {
      id: invoice.id,
      voidedAt: invoice.voidedAt?.toISOString(),
    });
  }
}

function assertDraft(invoice: Invoice, verb: string): void {
  if (invoice.state === "draft") return;
  throw new InvalidStateTransitionError(
    `Invoice ${invoice.id} is ${invoice.state} and cannot be ${verb}`,
    { id: invoice.id, state: invoice.state },
  );
}

function assertBuyer(buyer: BuyerSnapshot): void {
  if (buyer.name.trim() === "") {
    throw new ValidationError("An invoice requires a buyer name", {});
  }
}
