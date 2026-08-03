/**
 * Payment status route.
 *
 * One view of a payment: what was owed (the intent), how far along paying it is
 * (the clearing transaction), and how it got there (the timeline). Accepts
 * either the intent id or the clearing transaction id, since callers hold
 * whichever they were handed.
 */

import type { ClearingTransaction } from "@mayarin/clearing";
import { hasPrefix } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toDepositDto, toPaymentDto } from "../serialization.ts";

export function paymentRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/:id", async (c) => {
    const id = c.req.param("id");

    if (hasPrefix(id, "clr")) {
      const transaction = await container.engine.getById(id);
      const [intent, events, deposit] = await Promise.all([
        container.intents.getById(transaction.paymentIntentId),
        container.engine.history(transaction.id),
        depositFor(container, transaction),
      ]);
      return c.json(toPaymentDto(intent, transaction, events, deposit));
    }

    const intent = await container.intents.getById(id);
    const transaction = await container.engine.findByPaymentIntentId(intent.id);
    const events = transaction === null ? [] : await container.engine.history(transaction.id);
    const deposit = await depositFor(container, transaction);

    return c.json(toPaymentDto(intent, transaction, events, deposit));
  });

  return app;
}

/**
 * Reads the payer's side of a payment, or null when this deployment has no
 * chain layer. Confirmations are display-only, so an unreachable RPC renders
 * them as zero rather than failing the whole read.
 */
async function depositFor(container: Container, transaction: ClearingTransaction | null) {
  const deposit = transaction?.deposit;
  const repository = container.deposits;
  const chain = container.config.chain;
  if (transaction === null || deposit === undefined || repository === undefined) return null;
  if (chain === undefined) return null;

  const deposits = await repository.listByAddress(deposit.chain, deposit.address);
  const head = await container.chainHead?.(deposit.chain).catch(() => undefined);

  return toDepositDto(transaction, deposits, head?.number, chain.confirmations[deposit.chain]);
}
