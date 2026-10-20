import { describe, expect, test } from "bun:test";
import type { DueEscrow } from "@mayarin/db";
import type { EscrowState } from "@mayarin/provider-evm";
import { FixedClock } from "@mayarin/shared";
import { disputeOf } from "../src/services/escrow-dispute.ts";
import { EscrowKeeper } from "../src/services/escrow-keeper.ts";
import { InMemoryEscrowDisputeLog } from "./fixtures/escrow-disputes.ts";

const NOW = new Date("2026-10-10T00:00:00.000Z");
const NOW_S = BigInt(NOW.getTime() / 1_000);
const FACTORY = "0xCB6dd0781D36FE95a5ff69248498E48909BB4e1B";

function due(id: string, resolveBy = NOW_S + 86_400n): DueEscrow {
  return {
    clearingTransactionId: id,
    paymentIntentId: `pi_${id}`,
    merchantId: "mrc_1",
    chain: "arbitrum-sepolia",
    order: {
      intentId: `0x${"11".repeat(32)}`,
      settlementToken: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      minOut: 5_000_000n,
      fee: 25_000n,
      merchantSafe: "0x0000000000000000000000000000000000000e5c",
      refundTo: "0x000000000000000000000000000000000000cafe",
      deadline: 0n,
      signature: "0x",
      signer: "0x",
      escrow: {
        factory: FACTORY,
        payer: "0x000000000000000000000000000000000000cafe",
        payee: "0x000000000000000000000000000000000000beef",
        arbiter: "0x0000000000000000000000000000000000000000",
        releaseAfter: NOW_S - 1n,
        resolveBy,
      },
    },
  };
}

function harness(rows: DueEscrow[], state: EscrowState) {
  const marked: [string, string][] = [];
  const sent: { to: string; data: string }[] = [];
  const disputes = new InMemoryEscrowDisputeLog();
  const alerts: string[] = [];
  const notified: string[] = [];
  const resolved: string[] = [];
  const paid: string[] = [];
  const keeper = new EscrowKeeper({
    repository: {
      listDueEscrows: async () => rows,
      markEscrowOutcome: async (id, outcome) => {
        marked.push([id, outcome]);
      },
    },
    read: async () => state,
    send: async (_chain, to, data) => {
      sent.push({ to, data });
      return "0xhash";
    },
    disputes,
    alert: async (text) => {
      alerts.push(text);
    },
    notifier: {
      opened: async (dispute) => {
        notified.push(dispute.paymentIntentId);
      },
      message: async () => {},
      resolved: async (dispute) => {
        resolved.push(`${dispute.paymentIntentId}:${dispute.status}`);
      },
    },
    paid: {
      released: async (id) => {
        paid.push(id);
      },
    },
    clock: new FixedClock(NOW),
  });
  return { keeper, marked, sent, disputes, alerts, notified, resolved, paid };
}

const held = (disputed = false): EscrowState => ({
  outcome: "held",
  disputed,
  balance: 4_975_000n,
});

describe("EscrowKeeper (#304)", () => {
  test("releases an undisputed escrow once its hold has ended", async () => {
    const { keeper, marked, sent } = harness([due("clr_1")], held());

    expect(await keeper.tick()).toEqual([{ id: "clr_1", action: "release" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(FACTORY);
    expect(marked).toEqual([["clr_1", "released"]]);
  });

  test("refunds a dispute nobody decided by resolveBy", async () => {
    const { keeper, marked } = harness([due("clr_1", NOW_S)], held(true));

    expect(await keeper.tick()).toEqual([{ id: "clr_1", action: "refund" }]);
    expect(marked).toEqual([["clr_1", "refunded"]]);
  });

  test("leaves a dispute alone while the arbiter still has time", async () => {
    const { keeper, marked, sent } = harness([due("clr_1")], held(true));

    expect(await keeper.tick()).toEqual([]);
    expect(sent).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });

  test("records an escrow someone else already closed, and moves nothing", async () => {
    const { keeper, marked, sent } = harness([due("clr_1")], {
      outcome: "refunded",
      disputed: false,
      balance: 0n,
    });

    expect(await keeper.tick()).toEqual([{ id: "clr_1", action: "recorded" }]);
    expect(sent).toHaveLength(0);
    expect(marked).toEqual([["clr_1", "refunded"]]);
  });
});

describe("EscrowKeeper disputes (#313)", () => {
  test("opens the case file for a dispute nobody reported, and tells the merchant once", async () => {
    const { keeper, disputes, notified } = harness([due("clr_1")], held(true));

    await keeper.tick();
    await keeper.tick();
    expect(notified).toEqual(["pi_clr_1"]);
    const dispute = await disputes.findByPaymentIntentId("pi_clr_1");
    expect(dispute?.status).toBe("open");
    expect(dispute?.merchantId).toBe("mrc_1");
    expect(dispute?.resolveBy).toEqual(new Date(Number(NOW_S + 86_400n) * 1_000));
  });

  test("closes the case file with the refund at resolveBy", async () => {
    const { keeper, disputes, resolved } = harness([due("clr_1", NOW_S)], held(true));

    await keeper.tick();
    expect((await disputes.findByPaymentIntentId("pi_clr_1"))?.status).toBe("refunded");
    // Announced to the merchant, with the outcome, once.
    expect(resolved).toEqual(["pi_clr_1:refunded"]);
  });

  test("closes the case file when the arbiter already decided", async () => {
    const { keeper, disputes, resolved } = harness([due("clr_1")], {
      outcome: "released",
      disputed: true,
      balance: 0n,
    });
    await disputes.open(
      {
        paymentIntentId: "pi_clr_1",
        merchantId: "mrc_1",
        chain: "arbitrum-sepolia",
        factory: FACTORY,
        payer: "0xcafe",
        payee: "0xbeef",
        arbiter: "0xa1",
        releaseAfter: NOW,
        resolveBy: NOW,
      },
      NOW,
    );

    await keeper.tick();
    expect((await disputes.findByPaymentIntentId("pi_clr_1"))?.status).toBe("released");
    expect(resolved).toEqual(["pi_clr_1:released"]);

    // A second pass finds it closed already and announces nothing more.
    await keeper.tick();
    expect(resolved).toHaveLength(1);
  });

  test("warns once at 48 hours and once at 24 hours before resolveBy", async () => {
    const { keeper, disputes, alerts } = harness([], held(true));
    const open = (id: string, hoursLeft: number) =>
      disputes.open(
        {
          paymentIntentId: id,
          merchantId: "mrc_1",
          chain: "arbitrum-sepolia",
          factory: FACTORY,
          payer: "0xcafe",
          payee: "0xbeef",
          arbiter: "0xa1",
          releaseAfter: NOW,
          resolveBy: new Date(NOW.getTime() + hoursLeft * 3_600_000),
        },
        NOW,
      );
    await open("pi_far", 72);
    await open("pi_two_days", 40);
    await open("pi_one_day", 10);

    await keeper.tick();
    expect(alerts).toHaveLength(2);
    expect(alerts.some((text) => text.includes("pi_two_days"))).toBe(true);
    expect(alerts.some((text) => text.includes("pi_one_day"))).toBe(true);
    expect((await disputes.findByPaymentIntentId("pi_two_days"))?.alerted).toBe("48h");
    expect((await disputes.findByPaymentIntentId("pi_one_day"))?.alerted).toBe("24h");

    await keeper.tick();
    expect(alerts).toHaveLength(2);
  });
});

describe("EscrowKeeper paid notice", () => {
  test("tells the merchant they got paid when the hold ends undisputed", async () => {
    const { keeper, paid } = harness([due("clr_1")], held());
    await keeper.tick();
    expect(paid).toEqual(["clr_1"]);
  });

  test("says nothing when the arbiter released a disputed escrow", async () => {
    const row = due("clr_1");
    const { keeper, disputes, paid } = harness([row], {
      outcome: "released",
      disputed: true,
      balance: 0n,
    });
    await disputes.open(
      disputeOf(row.order, {
        paymentIntentId: row.paymentIntentId,
        merchantId: "mrc_1",
        chain: row.chain,
      }),
      NOW,
    );
    await keeper.tick();
    expect(paid).toEqual([]);
  });
});
