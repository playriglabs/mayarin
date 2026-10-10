import { describe, expect, test } from "bun:test";
import type { EscrowDispute } from "@mayarin/db";
import type { WebhookDelivery } from "@mayarin/notifications";
import { FixedClock, generateId } from "@mayarin/shared";
import { disputeNotifier } from "../src/services/dispute-notifier.ts";

const NOW = new Date("2026-10-02T12:00:00.000Z");

function dispute(): EscrowDispute {
  return {
    id: generateId("dsp", NOW.getTime()),
    paymentIntentId: "pi_1",
    merchantId: "mrc_1",
    chain: "base-sepolia",
    factory: "0x309bdd9af097bf0f3faaff718c5c6c9a7f511b18",
    payer: "0x000000000000000000000000000000000000cafe",
    payee: "0x000000000000000000000000000000000000beef",
    arbiter: "0x00000000000000000000000000000000000000a1",
    releaseAfter: NOW,
    resolveBy: new Date(NOW.getTime() + 7 * 86_400_000),
    status: "open",
    decidedAt: undefined,
    alerted: undefined,
    createdAt: NOW,
  };
}

const endpoint = {
  id: "whe_1",
  merchantId: "mrc_1",
  url: "https://merchant.example/hooks",
  secret: "s",
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("dispute notifier (#313)", () => {
  test("queues an escrow.disputed delivery per active endpoint, keyed by the dispute", async () => {
    const queued: WebhookDelivery[] = [];
    const notifier = disputeNotifier({
      webhooks: {
        endpoints: { listActiveByMerchant: async () => [endpoint] } as never,
        deliveries: {
          insertMany: async (rows: readonly WebhookDelivery[]) => {
            queued.push(...rows);
            return rows.length;
          },
        } as never,
      },
      clock: new FixedClock(NOW),
    });
    const opened = dispute();

    await notifier.opened(opened);

    expect(queued).toHaveLength(1);
    expect(queued[0]?.eventId).toBe(opened.id);
    expect(queued[0]?.status).toBe("PENDING");
    const body = JSON.parse(queued[0]?.body ?? "{}");
    expect(body.type).toBe("escrow.disputed");
    expect(body.data.paymentIntentId).toBe("pi_1");
    expect(body.data.reference).toMatch(/^\d{11}$/);
  });

  test("emails the merchant's admins with the reference and a link", async () => {
    const sent: { to: string[]; subject: string; text: string; html: string }[] = [];
    const notifier = disputeNotifier({
      email: {
        apiKey: "re_test",
        from: "Mayarin <n@mayarin.xyz>",
        recipients: async () => ["owner@shop.example"],
        dashboardUrl: "https://dashboard.mayarin.xyz/",
        fetch: (async (_url: string, init: RequestInit) => {
          sent.push(JSON.parse(String(init.body)));
          return new Response("{}", { status: 200 });
        }) as typeof fetch,
      },
      clock: new FixedClock(NOW),
    });
    const opened = dispute();

    await notifier.opened(opened);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(["owner@shop.example"]);
    expect(sent[0]?.subject).toMatch(/^Dispute #\d{11} opened/);
    expect(sent[0]?.text).toContain(`https://dashboard.mayarin.xyz/disputes/${opened.id}`);
    expect(sent[0]?.html).toContain(`href="https://dashboard.mayarin.xyz/disputes/${opened.id}"`);
    expect(sent[0]?.html).toContain("PP Neue Montreal");
    expect(sent[0]?.html).toContain("cid:mayarin-logo");
  });

  test("a failing channel is logged, never thrown", async () => {
    const notifier = disputeNotifier({
      email: {
        apiKey: "re_test",
        from: "Mayarin <n@mayarin.xyz>",
        recipients: async () => ["owner@shop.example"],
        fetch: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
      },
      clock: new FixedClock(NOW),
    });

    await expect(notifier.opened(dispute())).resolves.toBeUndefined();
  });
});
