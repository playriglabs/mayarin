/**
 * Completes a local-currency payment on TransFi's sandbox.
 *
 * Production never runs this: there, TransFi delivers real stablecoin to the
 * payment's deposit address and the chain watcher records it, like any deposit.
 * The sandbox moves no value, so that deposit will never exist — and a demo has
 * to be able to finish. This stands in for it, in two steps a payer's real
 * payment would have produced:
 *
 * 1. a short while after the order opens, mark the order paid on the sandbox;
 * 2. when TransFi itself reports the order delivered, and what it delivered is
 *    this payment's token and amount, record the asset as received.
 *
 * The order id comes from our own records, written when we opened the order —
 * never from a request — and the delivered token and amount are checked against
 * the payment, so a settled order cannot fund a payment it was not opened for.
 * Boot refuses the switch that enables this against anything but the sandbox.
 *
 * A failure for one order is logged and the next is still tried.
 */

import type { PaymentFundingRepository } from "@mayarin/db";
import { type TransfiClient, transfiTokenCode } from "@mayarin/provider-transfi";
import { type Clock, toDecimalString } from "@mayarin/shared";

/** Long enough for the QR to be seen on screen before it is "paid". */
const PAY_AFTER_MS = 8_000;
/** An order older than this is not chased: the payment has expired anyway. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const BATCH = 25;
/** A payment may be funded by up to this much more than it needs; beyond, it is not this payment. */
const MAX_OVERPAYMENT = 1.5;

export interface FiatSettlerOptions {
  readonly fundings: PaymentFundingRepository;
  readonly transfi: TransfiClient;
  readonly payments: {
    getPayment(id: string): Promise<{
      readonly transaction: {
        readonly id: string;
        readonly deposit?:
          | {
              readonly chain: string;
              readonly asset: string;
              readonly amount: Parameters<typeof toDecimalString>[0];
            }
          | undefined;
      } | null;
    }>;
  };
  readonly engine: { recordAssetReceived(id: string): Promise<unknown> };
  readonly clock: Clock;
}

/**
 * TransFi accepts the simulated status and applies it a moment later, so the
 * order still reads as unpaid for a few passes. Asking again is refused with
 * this; it means "already on its way", not a failure.
 */
const ALREADY_APPLIED = /already at the requested status/i;

export class FiatSettler {
  readonly #options: FiatSettlerOptions;
  /** Orders already marked paid by this process — once is enough, and asking again is noise. */
  readonly #simulated = new Set<string>();

  constructor(options: FiatSettlerOptions) {
    this.#options = options;
  }

  /** One pass. Returns the payment ids whose receipt was recorded. */
  async tick(): Promise<readonly string[]> {
    const { fundings, transfi, clock } = this.#options;
    const now = clock.now();
    const open = await fundings.listOpen(new Date(now.getTime() - MAX_AGE_MS), BATCH);
    const recorded: string[] = [];

    for (const funding of open) {
      try {
        const order = await transfi.getOrder(funding.orderId);

        if (order.status !== funding.status) {
          await fundings.update(funding.orderId, { status: order.status }, now);
        }

        if (order.status !== "asset_settled") {
          const due = now.getTime() - funding.createdAt.getTime() >= PAY_AFTER_MS;
          if (due && !this.#simulated.has(funding.orderId)) {
            this.#simulated.add(funding.orderId);
            await transfi.simulateSettled(funding.orderId).catch((error: unknown) => {
              if (!(error instanceof Error && ALREADY_APPLIED.test(error.message))) throw error;
            });
          }
          continue;
        }

        if (await this.#record(funding.paymentIntentId, order)) {
          recorded.push(funding.paymentIntentId);
          await fundings.update(funding.orderId, { status: order.status, settledAt: now }, now);
        }
      } catch (error) {
        console.error(
          `[fiat-settler] order ${funding.orderId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return recorded;
  }

  async #record(
    paymentIntentId: string,
    order: { readonly destinationCurrency: string; readonly destinationAmount: number },
  ): Promise<boolean> {
    const { payments, engine } = this.#options;
    const { transaction } = await payments.getPayment(paymentIntentId);
    const deposit = transaction?.deposit;
    if (transaction === null || deposit === undefined) return false;

    const code = transfiTokenCode(deposit.chain, deposit.asset, { sandbox: true });
    const required = Number(toDecimalString(deposit.amount));
    const matches =
      code !== undefined &&
      order.destinationCurrency === code &&
      order.destinationAmount >= required &&
      order.destinationAmount <= required * MAX_OVERPAYMENT;
    if (!matches) return false;

    await engine.recordAssetReceived(transaction.id);
    return true;
  }
}
