/**
 * Subscriptions over the API key (#296): what a SaaS backend calls to put a
 * signed-up user on a recurring plan.
 *
 * Only the schedule lives here. Billing — issuing each cycle's invoice and
 * emailing it — is the dashboard API's tick, which reads the same table, so a
 * subscription created here bills exactly like one created on the dashboard.
 *
 * The subscriber arrives inline (name + email) rather than as a dashboard
 * customer id: a SaaS knows its user's email, not a Mayarin customer id. The
 * merchant's customer with that email is reused, or created, so the dashboard
 * shows one customer however many plans they hold.
 */

import { type CustomerRepository, createCustomer } from "@mayarin/catalog";
import type { Invoice, InvoiceService } from "@mayarin/invoicing";
import { type Clock, generateId, type Money, NotFoundError } from "@mayarin/shared";
import {
  cancelSubscription,
  createSubscription,
  pauseSubscription,
  resumeSubscription,
  SUBSCRIPTION_METADATA_KEY,
  type Subscription,
  type SubscriptionInterval,
  type SubscriptionRepository,
} from "@mayarin/subscriptions";

export interface CreateSubscriptionCommand {
  readonly customer: { readonly name: string; readonly email: string };
  readonly description: string;
  readonly amount: Money;
  readonly interval: SubscriptionInterval;
  /** First billing date. Defaults to now: the first cycle bills on the next tick. */
  readonly startAt?: Date;
  readonly daysUntilDue: number;
}

export interface SubscriptionWithCycles {
  readonly subscription: Subscription;
  /** Every cycle billed so far, newest first. */
  readonly cycles: readonly Invoice[];
}

export class SubscriptionApiService {
  readonly #subscriptions: SubscriptionRepository;
  readonly #customers: CustomerRepository;
  readonly #invoices: InvoiceService;
  readonly #clock: Clock;

  constructor(options: {
    readonly subscriptions: SubscriptionRepository;
    readonly customers: CustomerRepository;
    readonly invoices: InvoiceService;
    readonly clock: Clock;
  }) {
    this.#subscriptions = options.subscriptions;
    this.#customers = options.customers;
    this.#invoices = options.invoices;
    this.#clock = options.clock;
  }

  async create(merchantId: string, command: CreateSubscriptionCommand): Promise<Subscription> {
    const now = this.#clock.now();
    let customer = await this.#customers.findByEmail(merchantId, command.customer.email);
    if (customer === null) {
      customer = createCustomer({ merchantId, ...command.customer, now });
      await this.#customers.insert(customer);
    }

    const subscription = createSubscription({
      id: generateId("sub", now.getTime()),
      merchantId,
      subscriber: {
        customerId: customer.id,
        name: customer.name,
        ...(customer.email === undefined ? {} : { email: customer.email }),
      },
      description: command.description,
      amount: command.amount,
      interval: command.interval,
      anchorAt: command.startAt ?? now,
      daysUntilDue: command.daysUntilDue,
      now,
    });
    await this.#subscriptions.insert(subscription);
    return subscription;
  }

  async list(merchantId: string): Promise<readonly Subscription[]> {
    return this.#subscriptions.listByMerchant(merchantId);
  }

  /** The subscription alone, without listing its cycles. */
  async find(merchantId: string, id: string): Promise<Subscription> {
    return this.#own(merchantId, id);
  }

  async get(merchantId: string, id: string): Promise<SubscriptionWithCycles> {
    const subscription = await this.#own(merchantId, id);
    const invoices = await this.#invoices.listInvoices({ merchantId, limit: 500 });
    return {
      subscription,
      cycles: invoices.filter(
        (invoice) => invoice.metadata[SUBSCRIPTION_METADATA_KEY] === subscription.id,
      ),
    };
  }

  async pause(merchantId: string, id: string): Promise<Subscription> {
    return this.#change(merchantId, id, pauseSubscription);
  }

  async resume(merchantId: string, id: string): Promise<Subscription> {
    return this.#change(merchantId, id, resumeSubscription);
  }

  async cancel(merchantId: string, id: string): Promise<Subscription> {
    return this.#change(merchantId, id, cancelSubscription);
  }

  /** A foreign subscription answers 404: the id was not the caller's to know. */
  async #own(merchantId: string, id: string): Promise<Subscription> {
    const subscription = await this.#subscriptions.findById(id);
    if (subscription === null || subscription.merchantId !== merchantId) {
      throw new NotFoundError(`Subscription ${id} not found`, { id });
    }
    return subscription;
  }

  async #change(
    merchantId: string,
    id: string,
    transition: (subscription: Subscription, now: Date) => Subscription,
  ): Promise<Subscription> {
    const subscription = await this.#own(merchantId, id);
    const next = transition(subscription, this.#clock.now());
    if (next !== subscription) await this.#subscriptions.update(next, subscription.version);
    return next;
  }
}
