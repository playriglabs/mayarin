/**
 * Subscriptions (#296), behind the merchant's session — plus the billing tick.
 *
 * Send-to-pay: every cycle is an ordinary invoice issued to the subscriber and,
 * when they have an email, sent to them. Everything a paid invoice already
 * does — the hosted pay page, every rail including x402, paid/overdue status,
 * receipts (#293) — a cycle gets for free, and a payment on it carries
 * `metadata.subscriptionId` into the payment webhooks.
 *
 * **One cycle, one invoice, one email, however often the tick runs.** The
 * invoice's idempotency key and the email's delivery id are both the cycle key
 * (`${subscriptionId}:${billingDate}`), and the subscription only advances
 * under its optimistic lock. A crash between issuing and advancing replays into
 * the same invoice and the same email, then advances.
 */

import type { MerchantRepository } from "@mayarin/auth";
import type { Invoice, InvoiceService } from "@mayarin/invoicing";
import {
  type AssetCode,
  type Clock,
  ConcurrencyError,
  ConfigurationError,
  formatMoneyLocale,
  generateId,
  isMayarinError,
  type Money,
  NotFoundError,
} from "@mayarin/shared";
import {
  cancelSubscription,
  createSubscription,
  cycleKey,
  isDue,
  markBilled,
  nextBillingAt,
  pauseSubscription,
  resumeSubscription,
  SUBSCRIPTION_METADATA_KEY,
  type Subscription,
  type SubscriptionInterval,
  type SubscriptionRepository,
} from "@mayarin/subscriptions";
import type { Scope } from "../dto/auth.ts";
import { snapshotOf } from "../merchant-snapshot.ts";
import type { InvoiceEmailSender } from "./invoice-email-service.ts";

const DAY_MS = 86_400_000;

/** "30 September 2026" — the period date as the printed invoice reads it. */
function periodDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" });
}
/** Subscriptions checked per tick. Plenty for one worker a minute. */
const TICK_BATCH = 500;

export interface SubscriptionServiceOptions {
  readonly subscriptions: SubscriptionRepository;
  readonly merchants: MerchantRepository;
  readonly customers: {
    get(scope: Scope, id: string): Promise<{ id: string; name: string; email?: string }>;
  };
  readonly invoices: InvoiceService;
  readonly emails: InvoiceEmailSender;
  /** Origin of the hosted invoice page a cycle's email links to. */
  readonly checkoutBaseUrl: string;
  readonly clock: Clock;
}

export interface CreateSubscriptionRequest {
  readonly customerId: string;
  readonly description: string;
  readonly amount: Money;
  readonly interval: SubscriptionInterval;
  /** First billing date. Defaults to now: the first cycle bills on the next tick. */
  readonly startAt?: Date;
  readonly daysUntilDue: number;
}

export interface SubscriptionDetail {
  readonly subscription: Subscription;
  /** Every cycle billed so far, newest first. */
  readonly cycles: readonly Invoice[];
}

export interface TickResult {
  readonly billed: number;
  readonly failed: number;
}

export class SubscriptionService {
  readonly #subscriptions: SubscriptionRepository;
  readonly #merchants: MerchantRepository;
  readonly #customers: SubscriptionServiceOptions["customers"];
  readonly #invoices: InvoiceService;
  readonly #emails: InvoiceEmailSender;
  readonly #checkoutBaseUrl: string;
  readonly #clock: Clock;

  constructor(options: SubscriptionServiceOptions) {
    this.#subscriptions = options.subscriptions;
    this.#merchants = options.merchants;
    this.#customers = options.customers;
    this.#invoices = options.invoices;
    this.#emails = options.emails;
    this.#checkoutBaseUrl = options.checkoutBaseUrl;
    this.#clock = options.clock;
  }

  async create(scope: Scope, request: CreateSubscriptionRequest): Promise<Subscription> {
    const customer = await this.#customers.get(scope, request.customerId);
    const now = this.#clock.now();
    const subscription = createSubscription({
      id: generateId("sub", now.getTime()),
      merchantId: scope.merchantId,
      subscriber: {
        customerId: customer.id,
        name: customer.name,
        ...(customer.email === undefined ? {} : { email: customer.email }),
      },
      description: request.description,
      amount: request.amount,
      interval: request.interval,
      anchorAt: request.startAt ?? now,
      daysUntilDue: request.daysUntilDue,
      now,
    });
    await this.#subscriptions.insert(subscription);
    return subscription;
  }

  async list(scope: Scope): Promise<readonly Subscription[]> {
    return this.#subscriptions.listByMerchant(scope.merchantId);
  }

  async detail(scope: Scope, id: string): Promise<SubscriptionDetail> {
    const subscription = await this.#own(scope, id);
    const invoices = await this.#invoices.listInvoices({
      merchantId: scope.merchantId,
      limit: 500,
    });
    return {
      subscription,
      cycles: invoices.filter(
        (invoice) => invoice.metadata[SUBSCRIPTION_METADATA_KEY] === subscription.id,
      ),
    };
  }

  async pause(scope: Scope, id: string): Promise<Subscription> {
    return this.#change(scope, id, pauseSubscription);
  }

  async resume(scope: Scope, id: string): Promise<Subscription> {
    return this.#change(scope, id, resumeSubscription);
  }

  async cancel(scope: Scope, id: string): Promise<Subscription> {
    return this.#change(scope, id, cancelSubscription);
  }

  /**
   * Bills every cycle that is due. One subscription's failure — a merchant
   * with no city set, an email provider hiccup — is counted and retried next
   * tick; it never stops the others.
   */
  async tick(): Promise<TickResult> {
    const now = this.#clock.now();
    const due = (await this.#subscriptions.listActive(TICK_BATCH)).filter((row) => isDue(row, now));
    let billed = 0;
    let failed = 0;
    for (const subscription of due) {
      try {
        await this.#bill(subscription, now);
        billed += 1;
      } catch (error) {
        // Another worker advanced it first: the cycle is billed, not failed.
        if (error instanceof ConcurrencyError) continue;
        failed += 1;
        console.error(
          `[subscriptions] cycle ${cycleKey(subscription)} failed:`,
          isMayarinError(error) ? error.message : error,
        );
      }
    }
    return { billed, failed };
  }

  /** Issues (or re-finds) the cycle's invoice, emails it once, then advances. */
  async #bill(subscription: Subscription, now: Date): Promise<void> {
    const key = cycleKey(subscription);
    const merchant = await this.#merchants.findById(subscription.merchantId);
    if (merchant === null) {
      throw new NotFoundError(`Merchant ${subscription.merchantId} not found`, {
        id: subscription.merchantId,
      });
    }

    const draft = await this.#invoices.createInvoice({
      merchantId: subscription.merchantId,
      merchant: snapshotOf(merchant),
      buyer: {
        name: subscription.subscriber.name,
        ...(subscription.subscriber.email === undefined
          ? {}
          : { email: subscription.subscriber.email }),
      },
      currency: subscription.amount.asset as AssetCode,
      lines: [{ name: subscription.description, unitPrice: subscription.amount, quantity: 1 }],
      notes: `Billing period from ${periodDate(nextBillingAt(subscription))}`,
      metadata: {
        [SUBSCRIPTION_METADATA_KEY]: subscription.id,
        customerId: subscription.subscriber.customerId,
      },
      idempotencyKey: key,
    });
    const invoice =
      draft.state === "draft"
        ? await this.#invoices.issueInvoice(draft.id, {
            dueAt: new Date(now.getTime() + subscription.daysUntilDue * DAY_MS),
            format: { prefix: "INV", includeYear: true },
          })
        : draft;

    const email = subscription.subscriber.email;
    if (email !== undefined && invoice.number !== undefined) {
      const total = formatMoneyLocale(invoice.total, { trimTrailingZeros: true });
      await this.#emails
        .sendInvoice({
          invoiceId: invoice.id,
          // Stable per cycle: a replayed tick is the same message, not a second one.
          deliveryId: key.replace(/[^\w-]/g, "-"),
          invoiceNumber: invoice.number,
          merchantName: invoice.merchant.name,
          merchantLogoUrl: merchant.logoUrl,
          buyerName: invoice.buyer.name,
          buyerEmail: email,
          total,
          outstanding: total,
          dueAt: invoice.dueAt?.toISOString() ?? null,
          url: `${this.#checkoutBaseUrl}/invoices/${invoice.id}/view`,
          subscription: { plan: subscription.description, interval: subscription.interval },
        })
        .catch((error: unknown) => {
          // A deployment with no email configured still bills: the invoice is
          // issued and the merchant sends its link. Anything else — a provider
          // outage — fails the cycle so the next tick sends it.
          if (!(error instanceof ConfigurationError)) throw error;
        });
    }

    await this.#subscriptions.update(markBilled(subscription, now), subscription.version);
  }

  async #own(scope: Scope, id: string): Promise<Subscription> {
    const subscription = await this.#subscriptions.findById(id);
    if (subscription === null || subscription.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Subscription ${id} not found`, { id });
    }
    return subscription;
  }

  async #change(
    scope: Scope,
    id: string,
    transition: (subscription: Subscription, now: Date) => Subscription,
  ): Promise<Subscription> {
    const subscription = await this.#own(scope, id);
    const next = transition(subscription, this.#clock.now());
    if (next !== subscription) await this.#subscriptions.update(next, subscription.version);
    return next;
  }
}
