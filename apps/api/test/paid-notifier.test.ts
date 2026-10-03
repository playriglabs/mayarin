import { describe, expect, test } from "bun:test";
import type { ClearingTransaction } from "@mayarin/clearing";
import type { NotifiableEvent } from "@mayarin/notifications";
import { FixedClock } from "@mayarin/shared";
import { PaidNotifier } from "../src/services/paid-notifier.ts";

const NOW = new Date("2026-10-10T00:00:00.000Z");

function event(id: string, state: NotifiableEvent["state"], occurredAt = NOW): NotifiableEvent {
  return {
    id,
    merchantId: "mrc_1",
    paymentIntentId: `pi_${id}`,
    clearingTransactionId: `clr_${id}`,
    type: "payment.state_changed",
    state,
    sequence: 9,
    metadata: {},
    occurredAt,
  };
}

function transaction(id: string, escrowed = false): ClearingTransaction {
  return {
    id: `clr_${id}`,
    paymentIntentId: `pi_${id}`,
    merchant: { id: "mrc_1", name: "Toko", city: "Jakarta", countryCode: "ID" },
    sourceAmount: { amount: 5_000_000n, asset: "USDC" },
    netAmount: { amount: 4_975_000n, asset: "USDC" },
    ...(escrowed ? { contract: { order: { escrow: {} } } } : {}),
  } as unknown as ClearingTransaction;
}

function harness(events: NotifiableEvent[], cursorAt?: string) {
  let cursor = cursorAt;
  const mails: { subject: string; key: string | null }[] = [];
  const notifier = new PaidNotifier({
    outbox: {
      listAfter: async (after) => events.filter((e) => after === undefined || e.id > after),
    },
    cursor: {
      get: async () => cursor,
      set: async (id) => {
        cursor = id;
      },
    },
    transactions: {
      findById: async (id) => transaction(id.replace("clr_", ""), id.includes("escrow")),
    },
    email: {
      apiKey: "re_test",
      from: "Mayarin <n@mayarin.xyz>",
      recipients: async () => ["admin@toko.id"],
      dashboardUrl: "https://dashboard.mayarin.xyz/",
      fetch: (async (_url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        mails.push({
          subject: JSON.parse(String(init.body)).subject,
          key: headers.get("idempotency-key"),
        });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    },
    clock: new FixedClock(NOW),
  });
  return { notifier, mails, cursor: () => cursor };
}

describe("PaidNotifier", () => {
  test("mails a payment that completed without escrow, once, and moves the cursor", async () => {
    const { notifier, mails, cursor } = harness(
      [event("01A", "SETTLED"), event("01B", "SUCCESS")],
      "00",
    );
    expect(await notifier.tick()).toBe(1);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toStartWith("🎉 You got paid");
    expect(mails[0]?.key).toBe("payment-paid-pi_01B");
    expect(cursor()).toBe("01B");

    expect(await notifier.tick()).toBe(0);
    expect(mails).toHaveLength(1);
  });

  test("leaves an escrowed payment to the keeper", async () => {
    const { notifier, mails } = harness([event("escrow", "SUCCESS")], "00");
    expect(await notifier.tick()).toBe(0);
    expect(mails).toHaveLength(0);
  });

  test("on its first run, does not mail payments from before it started", async () => {
    const { notifier, mails, cursor } = harness([
      event("01A", "SUCCESS", new Date("2026-01-01T00:00:00.000Z")),
      event("01B", "SUCCESS"),
    ]);
    expect(await notifier.tick()).toBe(1);
    expect(mails[0]?.key).toBe("payment-paid-pi_01B");
    expect(cursor()).toBe("01B");
  });

  test("released mails the escrowed payment", async () => {
    const { notifier, mails } = harness([]);
    await notifier.released("clr_01C");
    expect(mails).toHaveLength(1);
    expect(mails[0]?.key).toBe("payment-paid-pi_01C");
  });
});
