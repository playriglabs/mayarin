import { describe, expect, test } from "bun:test";
import { FixedClock } from "@mayarin/shared";
import { checkStatically, confirmSettlement } from "@mayarin/x402";
import {
  ASSET,
  CHAIN,
  chainState,
  facilitatorFor,
  forgedPayment,
  MERCHANT,
  NETWORK,
  NOW,
  PAYER,
  REQUIREMENTS,
  signedPayment,
  transferLog,
} from "./harness.ts";

describe("supports", () => {
  test("claims its own network and the exact scheme, nothing else", () => {
    const { facilitator } = facilitatorFor(chainState());

    expect(facilitator.supports(REQUIREMENTS)).toBe(true);
    expect(facilitator.supports({ ...REQUIREMENTS, network: "eip155:296" })).toBe(false);
    expect(facilitator.supports({ ...REQUIREMENTS, scheme: "upto" })).toBe(false);
  });
});

describe("verify", () => {
  test("accepts a genuinely signed authorization", async () => {
    const { facilitator } = facilitatorFor(chainState());

    const result = await facilitator.verify(await signedPayment(), REQUIREMENTS);

    expect(result).toEqual({ isValid: true, payer: PAYER.address });
  });

  // Every static check passes: the amounts match, the recipient is right, the
  // window is open, the signature is the correct length. Only recovery catches
  // it — which is exactly the case a stubbed verifier would wave through, and
  // the reason this harness signs with a real key.
  test("rejects an authorization somebody else signed", async () => {
    const { facilitator } = facilitatorFor(chainState());
    const forged = await forgedPayment();

    expect(checkStatically(forged, REQUIREMENTS, NOW)).toBeUndefined();

    const result = await facilitator.verify(forged, REQUIREMENTS);

    expect(result).toMatchObject({ isValid: false, invalidReason: "invalid_signature" });
  });

  // A single flipped byte in the signature recovers to some other address
  // rather than failing to parse, so this is the same check, reached a
  // different way.
  test("rejects an authorization whose signature has been altered", async () => {
    const { facilitator } = facilitatorFor(chainState());
    const honest = await signedPayment();
    const signature = honest.payload.signature as string;
    const flipped = `${signature.slice(0, 20)}${signature[20] === "0" ? "1" : "0"}${signature.slice(21)}`;

    const result = await facilitator.verify(
      { ...honest, payload: { ...honest.payload, signature: flipped } },
      REQUIREMENTS,
    );

    expect(result).toMatchObject({ isValid: false, invalidReason: "invalid_signature" });
  });

  test("reports a short balance without simulating", async () => {
    const state = chainState({ balance: 1n, simulationFails: true });
    const { facilitator } = facilitatorFor(state);

    const result = await facilitator.verify(await signedPayment(), REQUIREMENTS);

    expect(result).toMatchObject({ isValid: false, invalidReason: "insufficient_funds" });
  });

  // A nonce the token has recorded means the transfer already happened, or
  // somebody else spent the authorization. Broadcasting again buys a revert.
  test("reports a spent authorization", async () => {
    const { facilitator } = facilitatorFor(chainState({ authorizationUsed: true }));

    const result = await facilitator.verify(await signedPayment(), REQUIREMENTS);

    expect(result).toMatchObject({ isValid: false, invalidReason: "authorization_already_used" });
  });

  test("reports a failing simulation without a reason the payer cannot use", async () => {
    const { facilitator } = facilitatorFor(chainState({ simulationFails: true }));

    const result = await facilitator.verify(await signedPayment(), REQUIREMENTS);

    expect(result).toEqual({
      isValid: false,
      invalidReason: "simulation_failed",
      payer: PAYER.address,
    });
  });

  test("rejects an expired authorization before spending an RPC call", async () => {
    const late = new FixedClock(new Date(1_740_680_000 * 1000));
    const state = chainState({ balance: 0n });
    const { facilitator } = facilitatorFor(state, late);

    const result = await facilitator.verify(await signedPayment(), REQUIREMENTS);

    // Expiry, not the empty balance: the static checks run first.
    expect(result).toMatchObject({ isValid: false, invalidReason: "expired_authorization" });
  });
});

describe("settle", () => {
  test("broadcasts and reports the transaction", async () => {
    const state = chainState();
    const { facilitator } = facilitatorFor(state);
    const payment = await signedPayment();
    const hash = `0x${"0".repeat(63)}1`;
    state.receipts.set(hash, {
      status: "success",
      logs: [transferLog(PAYER.address, MERCHANT, 10_000n)],
    });

    const result = await facilitator.settle(payment, REQUIREMENTS);

    expect(result).toMatchObject({ success: true, transaction: hash, network: NETWORK });
    expect(state.broadcasts).toEqual([hash]);
  });

  // The gap between verifying and settling is one in which the balance can
  // move and the nonce can be spent. Finding out from a revert instead costs a
  // transaction fee on every occurrence.
  test("re-verifies and does not broadcast a payment that has gone bad", async () => {
    const state = chainState({ authorizationUsed: true });
    const { facilitator } = facilitatorFor(state);

    const result = await facilitator.settle(await signedPayment(), REQUIREMENTS);

    expect(result).toMatchObject({ success: false, errorReason: "authorization_already_used" });
    expect(state.broadcasts).toEqual([]);
  });

  // A mined revert has a hash and moved nothing. Reporting success would hand
  // `confirmSettlement` a real transaction to find and reject — a slower route
  // to the same answer, through a more confusing error.
  test("reports a mined revert as a failure, with its hash", async () => {
    const state = chainState();
    const { facilitator } = facilitatorFor(state);
    const hash = `0x${"0".repeat(63)}1`;
    state.receipts.set(hash, { status: "reverted", logs: [] });

    const result = await facilitator.settle(await signedPayment(), REQUIREMENTS);

    expect(result).toMatchObject({
      success: false,
      errorReason: "transaction reverted",
      transaction: hash,
    });
  });

  // One key signs every settlement, and a nonce belongs to the key rather than
  // to a payment. Two broadcasts in flight at once both read the same pending
  // nonce and the second is rejected for bidding on a taken slot — at x402
  // volume that is once per API call, not once per payment.
  test("serialises broadcasts from the one operator key", async () => {
    const state = chainState({ broadcastDelayMs: 15 });
    const { facilitator } = facilitatorFor(state);
    const order: string[] = [];
    const first = `0x${"0".repeat(63)}1`;
    const second = `0x${"0".repeat(63)}2`;
    state.receipts.set(first, { status: "success", logs: [] });
    state.receipts.set(second, { status: "success", logs: [] });

    await Promise.all([
      facilitator
        .settle(await signedPayment({ nonce: `0x${"11".repeat(32)}` }), REQUIREMENTS)
        .then(() => order.push("a")),
      facilitator
        .settle(await signedPayment({ nonce: `0x${"22".repeat(32)}` }), REQUIREMENTS)
        .then(() => order.push("b")),
    ]);

    expect(state.broadcasts).toEqual([first, second]);
    expect(order).toHaveLength(2);
  });

  // One broadcast failing must not poison the queue for the next payment.
  test("a failed broadcast does not reject the settlement behind it", async () => {
    const state = chainState();
    const { facilitator } = facilitatorFor(state);
    let calls = 0;
    const hash = `0x${"0".repeat(63)}2`;
    state.receipts.set(hash, { status: "success", logs: [] });
    state.nextHash = () => {
      calls += 1;
      if (calls === 1) throw new Error("nonce too low");
      return hash as `0x${string}`;
    };

    const failed = await facilitator.settle(
      await signedPayment({ nonce: `0x${"11".repeat(32)}` }),
      REQUIREMENTS,
    );
    const succeeded = await facilitator.settle(
      await signedPayment({ nonce: `0x${"22".repeat(32)}` }),
      REQUIREMENTS,
    );

    expect(failed.success).toBe(false);
    expect(succeeded.success).toBe(true);
  });
});

describe("confirm", () => {
  test("reads the transfer a settlement actually made", async () => {
    const state = chainState();
    const { reader } = facilitatorFor(state);
    const hash = `0x${"cd".repeat(32)}`;
    state.receipts.set(hash, {
      status: "success",
      logs: [transferLog(PAYER.address, MERCHANT, 10_000n)],
    });

    const transfer = await reader.confirm(hash, NETWORK);

    expect(transfer).toEqual({
      from: PAYER.address,
      to: MERCHANT,
      value: "10000",
      asset: ASSET,
    });
  });

  test("and that transfer satisfies the confirmation guard", async () => {
    const state = chainState();
    const { reader } = facilitatorFor(state);
    const hash = `0x${"cd".repeat(32)}`;
    state.receipts.set(hash, {
      status: "success",
      logs: [transferLog(PAYER.address, MERCHANT, 10_000n)],
    });

    const confirmed = await confirmSettlement(
      { success: true, transaction: hash, network: NETWORK },
      REQUIREMENTS,
      reader,
    );

    expect(confirmed.payer).toBe(PAYER.address);
  });

  test("returns nothing for a transaction the chain does not have", async () => {
    const { reader } = facilitatorFor(chainState());

    expect(await reader.confirm(`0x${"00".repeat(32)}`, NETWORK)).toBeUndefined();
  });

  // It exists and it moved nothing, which is the same answer as far as a
  // payment is concerned.
  test("returns nothing for a reverted transaction", async () => {
    const state = chainState();
    const { reader } = facilitatorFor(state);
    const hash = `0x${"ee".repeat(32)}`;
    state.receipts.set(hash, {
      status: "reverted",
      logs: [transferLog(PAYER.address, MERCHANT, 10_000n)],
    });

    expect(await reader.confirm(hash, NETWORK)).toBeUndefined();
  });

  // Picking the first would be a guess, and what is being guessed at is which
  // transfer paid the merchant.
  test("refuses to choose between two transfers in one transaction", async () => {
    const state = chainState();
    const { reader } = facilitatorFor(state);
    const hash = `0x${"ff".repeat(32)}`;
    state.receipts.set(hash, {
      status: "success",
      logs: [
        transferLog(PAYER.address, MERCHANT, 10_000n),
        transferLog(PAYER.address, MERCHANT, 1n),
      ],
    });

    expect(reader.confirm(hash, NETWORK)).rejects.toThrow(/cannot tell which paid/);
  });

  test("refuses a network it does not read", async () => {
    const { reader } = facilitatorFor(chainState());

    expect(reader.confirm(`0x${"cd".repeat(32)}`, "eip155:296")).rejects.toThrow(/was asked for/);
  });
});

describe("callArgsFor", () => {
  // Wallets differ on whether `v` is 27/28 or 0/1. A 0/1 signature passed
  // through unchanged recovers to a different address rather than failing
  // loudly, so the token would reject a perfectly good authorization.
  test("normalises a 0/1 recovery id to 27/28", async () => {
    const { reader } = facilitatorFor(chainState());
    const payment = await signedPayment();
    const signature = payment.payload.signature as string;
    const lowered = `${signature.slice(0, 130)}${(
      Number.parseInt(signature.slice(130, 132), 16) - 27
    )
      .toString(16)
      .padStart(2, "0")}`;

    const args = reader.callArgsFor({
      ...payment,
      payload: { ...payment.payload, signature: lowered },
    });

    expect(args[6]).toBeGreaterThanOrEqual(27);
  });

  test("carries the chain and network it was built for", () => {
    const { reader } = facilitatorFor(chainState());

    expect(reader.chain).toBe(CHAIN);
    expect(reader.network).toBe(NETWORK);
  });

  test("uses the clock it was given rather than wall time", async () => {
    const { facilitator } = facilitatorFor(chainState(), new FixedClock(NOW));

    expect((await facilitator.verify(await signedPayment(), REQUIREMENTS)).isValid).toBe(true);
  });
});

describe("facilitator identity", () => {
  test("names itself by chain, so two chains are two facilitators", () => {
    // The registry refuses a shared name. A constant "local" made that refusal
    // fire the moment a deployment served a second chain — they were distinct
    // facilitators wearing one label, not a duplicate, and the API refused to
    // boot with `two x402 facilitators share a name`.
    const { facilitator } = facilitatorFor(chainState());

    expect(facilitator.name).toBe(`local:${CHAIN}`);
  });
});
