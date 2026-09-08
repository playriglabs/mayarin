/**
 * The join point between the x402 rail and the commerce layer (#273).
 *
 * This is the only service that is allowed to see both: `core/x402` must not
 * import `core/invoicing` or `core/catalog`, because an obligation is not a
 * fact about the payment rail and the rail's domain has no business knowing
 * what an invoice is. Here — an application service above both — the two
 * meet: an invoice's outstanding balance, or a payment link's total, becomes
 * a `PricedOffer` the existing `402` machinery prices and settles unchanged.
 *
 * Nothing here broadcasts, prices or locks. The quote row is the lock (see
 * `@mayarin/x402` `payable.ts`), the `X402Service` is the machinery, and this
 * service is the translation: obligation in, offer out; provenance in,
 * intent out.
 */

import type { LinkPreview, PaymentLink } from "@mayarin/catalog";
import { assertPayable, isLinkPayable } from "@mayarin/catalog";
import type { Invoice, InvoiceView } from "@mayarin/invoicing";
import { assertInvoicePayable } from "@mayarin/invoicing";
import type { Clock, Money } from "@mayarin/shared";
import { ValidationError } from "@mayarin/shared";
import type {
  PayableKind,
  PayableQuote,
  PayableQuoteRepository,
  PaymentPayload,
  PaymentRequired,
  PricedOffer,
} from "@mayarin/x402";
import { isPayableKind } from "@mayarin/x402";
import type { PayableProvenance, X402Service, X402Settlement } from "./x402.ts";

/** Enough of the invoicing service to quote, settle and index an invoice. */
export interface InvoiceViewSource {
  viewInvoice(id: string): Promise<InvoiceView>;
  /** The merchant rows behind the public index: listed invoices, newest first. */
  listListedInvoices(options: {
    readonly limit: number;
    readonly cursor?: { readonly id: string; readonly createdAt: Date };
  }): Promise<readonly Invoice[]>;
}

/** Enough of the catalog service to quote, settle and index a payment link. */
export interface PayableLinkSource {
  /** Throws `NotFoundError` — the caller has nothing else to say. */
  getLink(id: string): Promise<PaymentLink>;
  listListedLinks(options: {
    readonly limit: number;
    readonly cursor?: { readonly id: string; readonly createdAt: Date };
  }): Promise<readonly PaymentLink[]>;
}

/**
 * Enough of the checkout service to price a catalog link. Absent on a
 * deployment with no checkout: a fixed link is priced by the link itself, and
 * only a catalog link needs the preview — so it is refused rather than priced
 * from a total nobody computed.
 */
export interface LinkPreviewSource {
  previewLink(linkId: string): Promise<LinkPreview>;
}

export interface X402PayablesOptions {
  readonly x402: X402Service;
  readonly quotes: PayableQuoteRepository;
  readonly invoices: InvoiceViewSource;
  readonly links: PayableLinkSource;
  readonly previews?: LinkPreviewSource;
  readonly clock: Clock;
  /** How long a payable's quoted price is held. Seconds. */
  readonly quoteTtlSeconds: number;
}

/** Where an agent pays a payable. Fixed, unversioned, like every x402 path. */
export function payableUrl(kind: PayableKind, id: string): string {
  return `/x402/payables/${kind}/${id}`;
}

export interface PayableListCursor {
  readonly kind: PayableKind;
  readonly id: string;
  readonly createdAt: Date;
}

export interface ListPayablesOptions {
  readonly limit: number;
  readonly cursor?: PayableListCursor;
}

/** One row of the public cross-merchant payable index. */
export interface PayableListEntry {
  readonly kind: PayableKind;
  readonly id: string;
  /** The obligation's own age — also the keyset half of the index cursor. */
  readonly createdAt: Date;
  readonly merchant: { readonly id: string; readonly name: string };
  readonly title?: string;
  /** What a `402` on this entry would quote: the outstanding balance or total. */
  readonly amount: Money;
  readonly url: string;
  readonly dueAt?: Date;
}

/** One payable, ready to become an offer: what it costs, and who to pay it to. */
interface PayableFacts {
  readonly merchantId: string;
  readonly url: string;
  readonly description?: string;
  readonly price: Money;
  readonly provenance: PayableProvenance;
}

/** An index entry before the sort keys are stripped for the wire. */
interface IndexedPayable {
  readonly kind: PayableKind;
  readonly id: string;
  readonly createdAt: Date;
  readonly merchant: { readonly id: string; readonly name: string };
  readonly title?: string;
  readonly amount: Money;
  readonly url: string;
  readonly dueAt?: Date;
}

export class X402PayableService {
  readonly #options: X402PayablesOptions;

  constructor(options: X402PayablesOptions) {
    this.#options = options;
  }

  /**
   * The listed payables across every merchant, newest first — the discovery
   * surface an agent reads before it has met anyone (#273).
   *
   * Both kinds are read with the same cutoff and merged here rather than in
   * SQL: an index over two domains has no single table to keyset over, and
   * the honest alternative — one query per kind, merged and re-sliced —
   * costs one extra row per kind, not one per entry.
   *
   * Payability is a read-time fact, so it is filtered here rather than
   * stored: a draft, a voided invoice, a paid-in-full one or a disabled link
   * is not listed even though its `listed` flag is set, because a discovery
   * reader is being told what they can *pay*. Fixed links only: a catalog
   * link's total is derived at preview, and an index row must be the price
   * an agent would actually be quoted.
   */
  async listPayables(options: ListPayablesOptions): Promise<readonly PayableListEntry[]> {
    const probe = options.limit + 1;
    const cutoff = options.cursor;

    const [invoiceRows, links] = await Promise.all([
      this.#options.invoices.listListedInvoices({
        limit: probe,
        ...(cutoff === undefined ? {} : { cursor: { id: cutoff.id, createdAt: cutoff.createdAt } }),
      }),
      this.#options.links.listListedLinks({
        limit: probe,
        ...(cutoff === undefined ? {} : { cursor: { id: cutoff.id, createdAt: cutoff.createdAt } }),
      }),
    ]);

    // The index owes the reader the price a `402` would quote, and an
    // invoice's is the *outstanding* balance — a fact the listed-row read
    // cannot know, because it lives in the payments recorded against it. So
    // each candidate is resolved through `viewInvoice`, capped at `limit + 1`
    // calls: correctness over one query per entry, and the probe bounds it.
    const views = await Promise.all(
      invoiceRows.map(
        async (invoice) => [invoice, await this.#options.invoices.viewInvoice(invoice.id)] as const,
      ),
    );

    const now = this.#options.clock.now();
    const entries = [
      ...views.flatMap(([invoice, view]) => this.#invoiceEntry(invoice, view)),
      ...links.flatMap((link) => this.#linkEntry(link, now)),
    ]
      .filter((entry) => afterCutoff(entry, cutoff))
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || (left.id < right.id ? 1 : -1),
      );

    return entries.slice(0, options.limit).map(
      (entry): PayableListEntry => ({
        kind: entry.kind,
        id: entry.id,
        createdAt: entry.createdAt,
        merchant: entry.merchant,
        ...(entry.title === undefined ? {} : { title: entry.title }),
        amount: entry.amount,
        url: entry.url,
        ...(entry.dueAt === undefined ? {} : { dueAt: entry.dueAt }),
      }),
    );
  }

  /** The index row for an invoice: nothing, unless issued with a balance. */
  #invoiceEntry(invoice: Invoice, view: InvoiceView): readonly IndexedPayable[] {
    if (invoice.state !== "issued") return [];
    if (view.outstanding.amount <= 0n) return [];

    return [
      {
        kind: "invoice" as const,
        id: invoice.id,
        createdAt: invoice.createdAt,
        merchant: { id: invoice.merchant.id, name: invoice.merchant.name },
        ...(invoice.number === undefined ? {} : { title: `Invoice ${invoice.number}` }),
        amount: view.outstanding,
        url: payableUrl("invoice", invoice.id),
        ...(invoice.dueAt === undefined ? {} : { dueAt: invoice.dueAt }),
      },
    ];
  }

  /** The index row for a link: nothing, unless payable and self-priced. */
  #linkEntry(link: PaymentLink, now: Date): readonly IndexedPayable[] {
    if (!isLinkPayable(link, now)) return [];
    // An open link is priced by the buyer, and an agent cannot be the buyer
    // who decides the amount: that is a checkout page, not a payable. A
    // catalog link is priced at preview — quotable by id, but not indexable,
    // because an index row must be the price an agent would actually be
    // quoted.
    if (link.kind !== "fixed" || link.amount === undefined) return [];

    return [
      {
        kind: "link" as const,
        id: link.id,
        createdAt: link.createdAt,
        merchant: { id: link.merchant.id, name: link.merchant.name },
        ...(link.title === undefined ? {} : { title: link.title }),
        amount: link.amount,
        url: payableUrl("link", link.id),
      },
    ];
  }

  /**
   * The `402` for one payable: the outstanding balance or total, quoted
   * against the merchant's own rails, held under the quote lock.
   *
   * Listing is not asked here and payability is: an unlisted payable still
   * answers, because its id is unguessable and that is the access control —
   * but a draft or a disabled link has nothing to quote.
   */
  async paymentRequired(kind: PayableKind, id: string): Promise<PaymentRequired> {
    const facts = await this.#payableFor(kind, id);
    const accepts = await this.#options.x402.merchantAccepts(facts.merchantId);
    if (accepts.length === 0) {
      throw new ValidationError(
        `x402 payable ${kind} ${id} has no way to be paid right now: the merchant has no rails`,
        { kind, obligationId: id },
      );
    }

    const now = this.#options.clock.now();
    const expiresAt = new Date(now.getTime() + this.#options.quoteTtlSeconds * 1000);

    // A live claim is served as it stands: an authorization may already be in
    // flight against this row, and re-quoting it would offer terms the payer
    // never signed. Everything else — spent, expired, settled — is refreshed.
    const existing = await this.#options.quotes.find(kind, id);
    const quote =
      existing !== undefined && existing.status === "claimed" && existing.expiresAt > now
        ? existing
        : await this.#saveQuote(kind, id, facts, accepts, expiresAt, now, existing);

    return this.#options.x402.paymentRequired({
      id,
      merchantId: facts.merchantId,
      url: facts.url,
      ...(facts.description === undefined ? {} : { description: facts.description }),
      price: quote.amount,
      accepts: quote.accepts,
      maxTimeoutSeconds: this.#options.quoteTtlSeconds,
    });
  }

  async #saveQuote(
    kind: PayableKind,
    id: string,
    facts: PayableFacts,
    accepts: PayableQuote["accepts"],
    expiresAt: Date,
    now: Date,
    existing: PayableQuote | undefined,
  ): Promise<PayableQuote> {
    const quote: PayableQuote = {
      kind,
      obligationId: id,
      merchantId: facts.merchantId,
      amount: facts.price,
      accepts,
      expiresAt,
      status: "quoted",
      // A refresh keeps the moment the obligation was first made payable.
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.#options.quotes.save(quote, { now });
    return quote;
  }

  /**
   * Settles an authorization against a payable: same refusals as
   * `paymentRequired` for what may be paid, then the machinery in
   * `X402Service.settlePayable` — the quote row, the replay short-circuits
   * and the nonce claim all live there.
   */
  async settle(kind: PayableKind, id: string, payment: PaymentPayload): Promise<X402Settlement> {
    const facts = await this.#payableFor(kind, id);
    // `accepts` is empty here on purpose: the rails the payer signed against
    // are the quote row's snapshot, which `settlePayable` reads for itself.
    // What it needs from the offer is the price and the URL the remedy
    // points at.
    const offer: PricedOffer = {
      id,
      merchantId: facts.merchantId,
      url: facts.url,
      ...(facts.description === undefined ? {} : { description: facts.description }),
      price: facts.price,
      accepts: [],
      maxTimeoutSeconds: this.#options.quoteTtlSeconds,
    };
    return this.#options.x402.settlePayable(offer, payment, facts.provenance);
  }

  /** One payable, with every refusal that precedes a quote. */
  async #payableFor(kind: PayableKind, id: string): Promise<PayableFacts> {
    if (!isPayableKind(kind)) {
      throw new ValidationError(`Unknown x402 payable kind "${kind}"`, { kind });
    }

    if (kind === "invoice") {
      const view = await this.#options.invoices.viewInvoice(id);
      assertInvoicePayable(view.invoice);
      if (view.outstanding.amount === 0n) {
        throw new ValidationError(`Invoice ${id} is already paid in full`, { id });
      }
      const invoice = view.invoice;
      return {
        merchantId: invoice.merchantId,
        url: payableUrl("invoice", id),
        ...(invoice.number === undefined ? {} : { description: `Invoice ${invoice.number}` }),
        price: view.outstanding,
        provenance: {
          kind: "invoice",
          obligationId: id,
          ...(invoice.number === undefined ? {} : { merchantReference: invoice.number }),
          metadata: { invoiceId: id },
        },
      };
    }

    const link = await this.#options.links.getLink(id);
    assertPayable(link, this.#options.clock.now());
    if (link.kind === "open") {
      throw new ValidationError(
        `Payment link ${id} names its own amount, so an agent cannot be the one to decide it; use the checkout page`,
        { id, url: payableUrl("link", id) },
      );
    }

    // A fixed link is priced by the link itself; a catalog link's total is
    // derived from its lines at preview, and a deployment with no checkout has
    // nothing to derive it with — a refusal, never a guess.
    const price =
      link.kind === "fixed" && link.amount !== undefined
        ? link.amount
        : (await this.#previewOf(id)).total;

    return {
      merchantId: link.merchant.id,
      url: payableUrl("link", id),
      ...(link.title === undefined ? {} : { description: link.title }),
      price,
      provenance: {
        kind: "link",
        obligationId: id,
        ...(link.merchantReference === undefined
          ? {}
          : { merchantReference: link.merchantReference }),
        metadata: { paymentLinkId: id },
      },
    };
  }

  async #previewOf(linkId: string) {
    const previews = this.#options.previews;
    if (previews === undefined) {
      throw new ValidationError(
        `Payment link ${linkId} is priced from its catalog, and this deployment has no checkout to price it; the merchant can convert it to a fixed link`,
        { linkId },
      );
    }
    return previews.previewLink(linkId);
  }
}

/**
 * Whether an entry sorts after the cursor's cutoff.
 *
 * Newest first, ties by id descending — the same order every keyset read in
 * this codebase uses. An entry from the *other* kind that ties on both keys is
 * kept: dropping it would silently hide a row nobody has served.
 */
function afterCutoff(
  entry: { readonly kind: PayableKind; readonly id: string; readonly createdAt: Date },
  cutoff: PayableListCursor | undefined,
): boolean {
  if (cutoff === undefined) return true;
  const created = entry.createdAt.getTime();
  const cutoffCreated = cutoff.createdAt.getTime();
  return (
    created < cutoffCreated ||
    (created === cutoffCreated &&
      (entry.id < cutoff.id || (entry.id === cutoff.id && entry.kind !== cutoff.kind)))
  );
}
