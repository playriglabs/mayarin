/**
 * Reports a payment that is still unfinished a while after the payer paid.
 *
 * Uptime checks see a process that is down. They do not see a worker that is up
 * and failing, which is the case that leaves a paid merchant waiting: the API
 * answers `/health` while a payment sits in SETTLING.
 */

import type { ClearingState, ClearingTransaction } from "@mayarin/clearing";

/** The payer has paid and the merchant has not been paid yet. */
const PAID_NOT_FINISHED: ReadonlySet<ClearingState> = new Set([
  "ASSET_RECEIVED",
  "CLEARING",
  "SETTLING",
  "SETTLED",
]);

export const STUCK_AFTER_MS = 10 * 60_000;

export function findStuck(
  transactions: readonly ClearingTransaction[],
  now: Date,
  afterMs = STUCK_AFTER_MS,
): ClearingTransaction[] {
  return transactions.filter(
    (transaction) =>
      PAID_NOT_FINISHED.has(transaction.state) &&
      now.getTime() - transaction.updatedAt.getTime() >= afterMs,
  );
}

export interface StuckPaymentWatch {
  readonly list: () => Promise<readonly ClearingTransaction[]>;
  readonly now: () => Date;
  readonly send: (text: string) => Promise<void>;
}

/**
 * One pass. Returns what it announced: a payment is reported once per state it
 * sticks in, and again if it recovers and sticks later.
 */
export function createStuckPaymentCheck(watch: StuckPaymentWatch): () => Promise<string[]> {
  const reported = new Map<string, ClearingState>();
  return async () => {
    const now = watch.now();
    const stuck = findStuck(await watch.list(), now);
    const stuckIds = new Set(stuck.map((transaction) => transaction.id));
    for (const id of reported.keys()) if (!stuckIds.has(id)) reported.delete(id);

    const announced: string[] = [];
    for (const transaction of stuck) {
      if (reported.get(transaction.id) === transaction.state) continue;
      const minutes = Math.round((now.getTime() - transaction.updatedAt.getTime()) / 60_000);
      const text = `Payment ${transaction.id} has been in ${transaction.state} for ${minutes} min after the payer paid`;
      await watch.send(text);
      reported.set(transaction.id, transaction.state);
      announced.push(text);
    }
    return announced;
  };
}

/** Logs the alert, and sends it to Telegram when a bot is set. A failed send throws, so the next pass retries it. */
export function alertSender(
  telegram: { readonly botToken: string; readonly chatId: string } | undefined,
): (text: string) => Promise<void> {
  return async (text) => {
    console.error(`[stuck-payments] ${text}`);
    if (telegram === undefined) return;
    const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: telegram.chatId, text }),
    });
    if (!response.ok) throw new Error(`Telegram answered ${response.status}`);
  };
}
