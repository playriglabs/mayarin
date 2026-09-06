/**
 * A `CrossAssetSettler` built to lie.
 *
 * The interesting tests are the ones where the chain disagrees with the plan,
 * so every number this reports is settable independently: a route that plans
 * cheap and spends dear, a swap that delivers short, a send that succeeds and a
 * confirmation that throws. A fake that can only tell the truth proves that the
 * happy path compiles.
 */

import { type Money, money, ProviderError, ValidationError } from "@mayarin/shared";
import type { CrossAssetSettler, CrossAssetSwap, CrossAssetSwapRequest } from "../src/index.ts";

export class FakeCrossAssetSettler implements CrossAssetSettler {
  /** Every request it was asked to plan, in order. */
  readonly planned: CrossAssetSwapRequest[] = [];
  /** Every request it actually broadcast, in order. */
  readonly sent: CrossAssetSwapRequest[] = [];

  #expectedIn: ((request: CrossAssetSwapRequest) => Money) | undefined;
  #spent: ((request: CrossAssetSwapRequest) => Money) | undefined;
  #delivered: ((request: CrossAssetSwapRequest) => Money) | undefined;
  #transaction = `0x${"cd".repeat(32)}`;
  #sendFails: Error | undefined;
  #confirmFails: Error | undefined;

  /** What the route says it will consume. Defaults to the whole authorization. */
  willPlan(expectedIn: Money | ((request: CrossAssetSwapRequest) => Money)): this {
    this.#expectedIn = typeof expectedIn === "function" ? expectedIn : () => expectedIn;
    return this;
  }

  /** What the swap actually consumed. Defaults to whatever it planned. */
  willSpend(spent: Money): this {
    this.#spent = () => spent;
    return this;
  }

  /** What the merchant received. Defaults to `exactOut` — a swap that worked. */
  willDeliver(delivered: Money): this {
    this.#delivered = () => delivered;
    return this;
  }

  willUseTransaction(transaction: string): this {
    this.#transaction = transaction;
    return this;
  }

  /** Broadcast refused. Nothing moved, and nothing should be recorded. */
  willFailToSend(error: Error): this {
    this.#sendFails = error;
    return this;
  }

  /** Broadcast landed, reading it back did not — the case the hash exists for. */
  willFailToConfirm(error: Error): this {
    this.#confirmFails = error;
    return this;
  }

  async plan(request: CrossAssetSwapRequest): Promise<Money> {
    this.planned.push(request);
    return this.#expectedIn?.(request) ?? request.held;
  }

  async send(request: CrossAssetSwapRequest): Promise<string> {
    if (this.#sendFails !== undefined) throw this.#sendFails;
    this.sent.push(request);
    return this.#transaction;
  }

  async confirm(transaction: string, request: CrossAssetSwapRequest): Promise<CrossAssetSwap> {
    if (this.#confirmFails !== undefined) throw this.#confirmFails;
    const delivered = this.#delivered?.(request) ?? request.exactOut;
    if (delivered.asset !== request.exactOut.asset) {
      throw new ProviderError(
        `The swap delivered ${delivered.asset}, not ${request.exactOut.asset}`,
        {
          retryable: false,
        },
      );
    }
    // The port's own contract: a swap that did not deliver the invoice has not
    // settled the payment, so it throws rather than reporting a shortfall the
    // caller might record.
    if (delivered.amount !== request.exactOut.amount) {
      throw new ValidationError("The swap did not deliver the invoiced amount", {
        delivered: delivered.amount.toString(),
        exactOut: request.exactOut.amount.toString(),
      });
    }
    const spent = this.#spent?.(request) ?? this.#expectedIn?.(request) ?? request.held;
    return { transaction, spent: money(spent.amount, request.held.asset), delivered };
  }
}
