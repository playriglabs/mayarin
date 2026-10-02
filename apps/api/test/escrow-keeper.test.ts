import { describe, expect, test } from "bun:test";
import type { DueEscrow } from "@mayarin/db";
import type { EscrowState } from "@mayarin/provider-evm";
import { FixedClock } from "@mayarin/shared";
import { EscrowKeeper } from "../src/services/escrow-keeper.ts";

const NOW = new Date("2026-10-10T00:00:00.000Z");
const NOW_S = BigInt(NOW.getTime() / 1_000);
const FACTORY = "0x545a2C8DD1fc765c61ea5dc2105427Be89c24A45";

function due(id: string, resolveBy = NOW_S + 86_400n): DueEscrow {
  return {
    clearingTransactionId: id,
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
    clock: new FixedClock(NOW),
  });
  return { keeper, marked, sent };
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
