/**
 * Which local-currency methods can take a payment without overcharging it.
 *
 * The provider's own method list says QRIS takes 1 IDR and then refuses less than
 * 92,015, so each method's real minimum is read from a quote and kept for a while.
 * A method whose minimum would deliver more than `tolerance` times what is owed is
 * left out: charging it would leave the difference at the deposit address, where
 * the payer cannot reclaim it. A method that cannot be evaluated stays, since a
 * provider outage is not evidence about a minimum; order creation applies the same
 * rule again.
 */

import {
  BelowMinimumError,
  type MethodFloor,
  methodFloor,
  minimumFitsPayment,
} from "@mayarin/provider-transfi";
import type { Clock } from "@mayarin/shared";

export interface FloorableMethod {
  readonly code: string;
  readonly type: string;
  readonly minAmount: number;
}

export type FloorQuote = (args: {
  readonly fiatCurrency: string;
  readonly fiatAmount: number;
  readonly cryptoCurrency: string;
  readonly paymentCode: string;
  readonly paymentType: string;
}) => Promise<{ readonly destinationAmount: number }>;

export interface MethodFloorsOptions {
  readonly quote: FloorQuote;
  readonly clock: Clock;
  /** How much more than owed an order may deliver. */
  readonly tolerance: number;
  readonly ttlMs?: number;
  /** Quotes in flight at once. */
  readonly concurrency?: number;
}

export class MethodFloors {
  readonly #options: MethodFloorsOptions;
  readonly #known = new Map<string, { readonly at: number; readonly floor: MethodFloor }>();

  constructor(options: MethodFloorsOptions) {
    this.#options = options;
  }

  async fit<T extends FloorableMethod>(
    methods: readonly T[],
    currency: string,
    cryptoCurrency: string,
    required: number,
  ): Promise<T[]> {
    const fits = new Map<string, boolean>();
    const queue = [...methods];
    const worker = async (): Promise<void> => {
      for (let method = queue.shift(); method !== undefined; method = queue.shift()) {
        const floor = await this.#floorOf(method, currency, cryptoCurrency);
        fits.set(
          method.code,
          floor === undefined || minimumFitsPayment(floor, required, this.#options.tolerance),
        );
      }
    };
    await Promise.all(Array.from({ length: this.#options.concurrency ?? 4 }, worker));
    return methods.filter((method) => fits.get(method.code) !== false);
  }

  async #floorOf(
    method: FloorableMethod,
    currency: string,
    cryptoCurrency: string,
  ): Promise<MethodFloor | undefined> {
    const key = `${currency}:${method.code}:${cryptoCurrency}`;
    const now = this.#options.clock.now().getTime();
    const known = this.#known.get(key);
    if (known !== undefined && now - known.at <= (this.#options.ttlMs ?? 10 * 60_000)) {
      return known.floor;
    }
    const found = await methodFloor({
      listedMin: method.minAmount,
      quote: (fiatAmount) =>
        this.#options
          .quote({
            fiatCurrency: currency,
            fiatAmount,
            cryptoCurrency,
            paymentCode: method.code,
            paymentType: method.type,
          })
          .catch((error: unknown) => {
            if (error instanceof BelowMinimumError) {
              return { destinationAmount: 0, belowMinimum: error.minLimit };
            }
            throw error;
          }),
    }).catch(() => undefined);
    // Only an answer is kept: an outage is not a minimum, and is asked again.
    if (found !== undefined) this.#known.set(key, { at: now, floor: found });
    return found;
  }
}
