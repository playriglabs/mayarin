/**
 * Live payment status, fanned out to whoever is watching (#13).
 *
 * One Postgres `LISTEN` connection per process, and an in-memory map from
 * payment intent id to the watchers on *this* process. A change committed by
 * any instance reaches every instance, so a payer connected to one of them sees
 * a payment settled by another — which the in-process event bus cannot do, and
 * which is the whole reason this exists rather than a subscription to that bus.
 *
 * The notification carries only an id. A watcher re-reads the payment, so there
 * is one source of truth and no payment detail travels through the channel.
 *
 * Server-Sent Events rather than WebSocket, deliberately: payment status is
 * one-way, `EventSource` reconnects on its own, and a plain HTTP response
 * survives proxies that refuse an upgrade. The bidirectionality a WebSocket
 * buys would never be used, and its reconnect logic would have to be written.
 */

import type { PaymentChangeSubscription } from "@mayarin/db";

export type PaymentWatcher = (paymentIntentId: string) => void;

export interface PaymentStreamOptions {
  /**
   * Subscribes to committed payment changes. Injected so the stream can be
   * tested — and driven — without a database.
   */
  readonly subscribe: (onChange: PaymentWatcher) => Promise<PaymentChangeSubscription>;
  /**
   * Ceiling on concurrently watched payments in this process.
   *
   * A checkout page left open holds a socket, and a payer who never closes the
   * tab should not be able to hold one forever alongside everyone else's. Past
   * the cap a watcher is refused and the caller falls back to polling, which
   * still works — degrading is the point.
   */
  readonly maxWatchedPayments?: number;
}

const DEFAULT_MAX_WATCHED = 1_000;

export class PaymentStream {
  readonly #subscribe: PaymentStreamOptions["subscribe"];
  readonly #max: number;
  readonly #watchers = new Map<string, Set<PaymentWatcher>>();
  #subscription: PaymentChangeSubscription | undefined;

  constructor(options: PaymentStreamOptions) {
    this.#subscribe = options.subscribe;
    this.#max = options.maxWatchedPayments ?? DEFAULT_MAX_WATCHED;
  }

  /** Opens the one listener this process needs. Idempotent. */
  async start(): Promise<void> {
    if (this.#subscription !== undefined) return;
    this.#subscription = await this.#subscribe((paymentIntentId) => {
      for (const watcher of this.#watchers.get(paymentIntentId) ?? []) {
        // One bad watcher must not stop the others being told.
        try {
          watcher(paymentIntentId);
        } catch {
          // Ignored: a watcher that throws has already lost its connection.
        }
      }
    });
  }

  async stop(): Promise<void> {
    const subscription = this.#subscription;
    this.#subscription = undefined;
    this.#watchers.clear();
    await subscription?.unlisten();
  }

  /** How many payments are currently watched here. */
  get watchedCount(): number {
    return this.#watchers.size;
  }

  /**
   * Watches one payment, returning the function that stops watching.
   *
   * Returns `undefined` when the process is already at its ceiling. The caller
   * is expected to fall back to polling rather than fail the request: a payer
   * who cannot stream must still be able to pay.
   */
  watch(paymentIntentId: string, watcher: PaymentWatcher): (() => void) | undefined {
    const existing = this.#watchers.get(paymentIntentId);
    if (existing === undefined && this.#watchers.size >= this.#max) return undefined;

    const set = existing ?? new Set<PaymentWatcher>();
    set.add(watcher);
    this.#watchers.set(paymentIntentId, set);

    return () => {
      set.delete(watcher);
      // Dropped once nobody is left, so an idle process holds no entries for
      // payments that finished hours ago.
      if (set.size === 0) this.#watchers.delete(paymentIntentId);
    };
  }
}
