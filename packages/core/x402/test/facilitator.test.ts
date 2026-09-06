import { describe, expect, test } from "bun:test";
import { ConfigurationError, ProviderError, ValidationError } from "@mayarin/shared";
import { confirmSettlement, facilitatorRegistry, type SettleResponse } from "../src/index.ts";
import {
  EXAMPLE_AUTHORIZATION,
  EXAMPLE_PAYMENT_PAYLOAD,
  EXAMPLE_REQUIREMENTS,
  FakeFacilitator,
  FakeSettlementConfirmer,
  transactionHashFor,
  withRequirements,
} from "../testing/index.ts";

const HASH = transactionHashFor(EXAMPLE_PAYMENT_PAYLOAD);

/** The error a promise rejected with. `rejects.toMatchObject` does not see an Error's own fields. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the promise to reject");
}

function settled(overrides: Partial<SettleResponse> = {}): SettleResponse {
  return {
    success: true,
    transaction: HASH,
    network: EXAMPLE_REQUIREMENTS.network,
    payer: EXAMPLE_AUTHORIZATION.from,
    ...overrides,
  };
}

function confirmerWithMatchingTransfer(): FakeSettlementConfirmer {
  return new FakeSettlementConfirmer().recordMatching(
    HASH,
    EXAMPLE_REQUIREMENTS,
    EXAMPLE_AUTHORIZATION.from,
  );
}

describe("facilitatorRegistry", () => {
  test("resolves the facilitator that claims the network", () => {
    const base = new FakeFacilitator({ name: "local", networks: ["eip155:84532"] });
    const arc = new FakeFacilitator({ name: "remote", networks: ["eip155:5042002"] });
    const registry = facilitatorRegistry([base, arc]);

    expect(registry.for(EXAMPLE_REQUIREMENTS).name).toBe("local");
    expect(registry.for(withRequirements({ network: "eip155:5042002" })).name).toBe("remote");
  });

  // A resource offering a network nothing can settle would otherwise fail at
  // the payer's first request, having already returned a 402 advertising it.
  // `canServe` is what lets boot refuse the configuration instead.
  test("reports a network nothing serves rather than answering with one", () => {
    const registry = facilitatorRegistry([new FakeFacilitator({ networks: ["eip155:84532"] })]);
    const unserved = withRequirements({ network: "eip155:5042002" });

    expect(registry.canServe(unserved)).toBe(false);
    expect(() => registry.for(unserved)).toThrow(ConfigurationError);
  });

  test("distinguishes a scheme it cannot serve from a network it cannot", () => {
    const registry = facilitatorRegistry([new FakeFacilitator({ schemes: ["exact"] })]);

    expect(registry.canServe(withRequirements({ scheme: "upto" }))).toBe(false);
  });

  // Two facilitators claiming one network is a mistake whose symptom is a
  // payment settling through whichever sorts first — non-deterministic, and
  // invisible until the two disagree about a transaction.
  test("refuses an ambiguous claim rather than picking one", () => {
    const registry = facilitatorRegistry([
      new FakeFacilitator({ name: "a" }),
      new FakeFacilitator({ name: "b" }),
    ]);

    expect(() => registry.for(EXAMPLE_REQUIREMENTS)).toThrow(/2 x402 facilitators claim/);
    expect(registry.canServe(EXAMPLE_REQUIREMENTS)).toBe(false);
  });

  test("refuses two facilitators sharing a name at construction", () => {
    expect(() =>
      facilitatorRegistry([
        new FakeFacilitator({ name: "local", networks: ["eip155:84532"] }),
        new FakeFacilitator({ name: "local", networks: ["eip155:296"] }),
      ]),
    ).toThrow(ConfigurationError);
  });
});

describe("confirmSettlement", () => {
  test("confirms a settlement the chain actually holds", async () => {
    const confirmed = await confirmSettlement(
      settled(),
      EXAMPLE_REQUIREMENTS,
      confirmerWithMatchingTransfer(),
    );

    expect(confirmed.transaction).toBe(HASH);
    expect(confirmed.payer).toBe(EXAMPLE_AUTHORIZATION.from);
  });

  // The whole reason this function exists. A facilitator — remote, or ours
  // while broken — can return any JSON it likes, and nothing may advance a
  // payment on the strength of it.
  test("refuses a success for a transaction that is not on the chain", async () => {
    await expect(
      confirmSettlement(settled(), EXAMPLE_REQUIREMENTS, new FakeSettlementConfirmer()),
    ).rejects.toThrow(ProviderError);
  });

  test("refuses a real transfer of the wrong token", async () => {
    const confirmer = new FakeSettlementConfirmer().record(HASH, EXAMPLE_REQUIREMENTS.network, {
      from: EXAMPLE_AUTHORIZATION.from,
      to: EXAMPLE_REQUIREMENTS.payTo,
      value: EXAMPLE_REQUIREMENTS.amount,
      asset: `0x${"99".repeat(20)}`,
    });

    await expect(confirmSettlement(settled(), EXAMPLE_REQUIREMENTS, confirmer)).rejects.toThrow(
      /moved 0x99/,
    );
  });

  test("refuses a real transfer to somebody else", async () => {
    const confirmer = new FakeSettlementConfirmer().record(HASH, EXAMPLE_REQUIREMENTS.network, {
      from: EXAMPLE_AUTHORIZATION.from,
      to: `0x${"88".repeat(20)}`,
      value: EXAMPLE_REQUIREMENTS.amount,
      asset: EXAMPLE_REQUIREMENTS.asset,
    });

    await expect(confirmSettlement(settled(), EXAMPLE_REQUIREMENTS, confirmer)).rejects.toThrow(
      /paid 0x88/,
    );
  });

  // One atomic unit of the right token to the right address is a real transfer
  // that settles nothing. Without this check it would settle an invoice.
  test("refuses a real transfer of the wrong amount", async () => {
    const confirmer = new FakeSettlementConfirmer().record(HASH, EXAMPLE_REQUIREMENTS.network, {
      from: EXAMPLE_AUTHORIZATION.from,
      to: EXAMPLE_REQUIREMENTS.payTo,
      value: "1",
      asset: EXAMPLE_REQUIREMENTS.asset,
    });

    await expect(confirmSettlement(settled(), EXAMPLE_REQUIREMENTS, confirmer)).rejects.toThrow(
      /moved 1, requirements asked for 10000/,
    );
  });

  test("refuses a settlement reported on a different network", async () => {
    await expect(
      confirmSettlement(
        settled({ network: "eip155:296" }),
        EXAMPLE_REQUIREMENTS,
        confirmerWithMatchingTransfer(),
      ),
    ).rejects.toThrow(ValidationError);
  });

  test.each([
    ["an empty hash", ""],
    ["something that is not a hash", "pending"],
    ["a hash of the wrong length", "0xdeadbeef"],
  ])("refuses a success carrying %s", async (_label, transaction) => {
    await expect(
      confirmSettlement(
        settled({ transaction }),
        EXAMPLE_REQUIREMENTS,
        confirmerWithMatchingTransfer(),
      ),
    ).rejects.toThrow(ValidationError);
  });

  // The clearing engine branches on `retryable`, so these two cases are the
  // only thing standing between "ask the chain again in a moment" and "burn gas
  // retrying a decision the facilitator already made" — the shape of the
  // execution-exhaustion incident this codebase paid for once already.
  test("treats a reported failure as final", async () => {
    const error = await rejection(
      confirmSettlement(
        settled({ success: false, errorReason: "insufficient_funds", transaction: "" }),
        EXAMPLE_REQUIREMENTS,
        confirmerWithMatchingTransfer(),
      ),
    );

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(false);
    expect(error.message).toMatch(/insufficient_funds/);
  });

  // A transaction that is genuinely not visible yet is a different thing from
  // one that will never exist, and only time tells them apart. Retryable, so
  // `resumeStuck` asks again rather than failing a payment that settled.
  test("marks an unseen transaction retryable so a resume can ask again", async () => {
    const error = await rejection(
      confirmSettlement(settled(), EXAMPLE_REQUIREMENTS, new FakeSettlementConfirmer()),
    );

    expect((error as ProviderError).retryable).toBe(true);
  });
});
