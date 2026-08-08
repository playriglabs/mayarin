/**
 * Wallet verification tests (#11).
 *
 * "Verified" has to mean a signature was recovered and matched, or the guard it
 * feeds is theatre. These pin the four things the challenge binds — merchant,
 * chain, address, expiry — and the indistinguishability of every failure.
 */

import { describe, expect, test } from "bun:test";
import { FixedClock, ValidationError } from "@mayarin/shared";
import {
  assertChallengeSigned,
  challengeMessage,
  createChallenge,
  isChallengeExpired,
  type SignatureVerifier,
} from "../src/index.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const ADDRESS = "0x1111111111111111111111111111111111111111";

function challenge(address = ADDRESS) {
  return createChallenge({
    merchantId: "mrc_1",
    chain: "base-sepolia",
    address,
    ttlSeconds: 600,
    now: new Date(NOW),
  });
}

/** Recovers whatever it was told to, so the test controls the "signer". */
function verifierReturning(address: string): SignatureVerifier {
  return { recover: async () => address };
}

describe("the challenge message", () => {
  test("binds merchant, chain, address, nonce and expiry", () => {
    const text = challengeMessage(challenge());

    // Each one closes a distinct replay: across merchants, across chains,
    // across a re-claim of the same address, and across time.
    expect(text).toContain("Merchant: mrc_1");
    expect(text).toContain("Chain: base-sepolia");
    expect(text).toContain(`Address: ${ADDRESS}`);
    expect(text).toContain("Nonce: wnc_");
    expect(text).toContain("Expires: 2026-01-01T00:10:00.000Z");
  });

  test("says plainly that it moves no funds", () => {
    // A wallet prompt showing opaque hex is a prompt people approve unread.
    expect(challengeMessage(challenge())).toContain("moves no funds");
  });

  test("two challenges for the same address differ", () => {
    expect(challenge().nonce).not.toBe(challenge().nonce);
  });

  test("the address is normalised, so case cannot fork the message", () => {
    expect(challenge(ADDRESS.toUpperCase()).address).toBe(ADDRESS);
  });
});

describe("assertChallengeSigned", () => {
  const clock = new FixedClock(NOW);

  test("a signature from the address proves control", async () => {
    await expect(
      assertChallengeSigned(challenge(), "0xsig", verifierReturning(ADDRESS), clock),
    ).resolves.toBeUndefined();
  });

  test("a signature recovered as mixed case still matches", async () => {
    await expect(
      assertChallengeSigned(challenge(), "0xsig", verifierReturning(ADDRESS.toUpperCase()), clock),
    ).resolves.toBeUndefined();
  });

  test("a signature from a different address is refused", async () => {
    const other = "0x2222222222222222222222222222222222222222";
    await expect(
      assertChallengeSigned(challenge(), "0xsig", verifierReturning(other), clock),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("a malformed signature is refused, and reads the same as a wrong one", async () => {
    const throwing: SignatureVerifier = {
      recover: async () => {
        throw new Error("invalid signature length");
      },
    };

    let message = "";
    try {
      await assertChallengeSigned(challenge(), "0xnope", throwing, clock);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    // Distinguishing them would help someone probing.
    expect(message).toBe("The signature does not prove control of this address");
  });

  test("an expired challenge is refused before the signature is even read", async () => {
    const late = new FixedClock("2026-01-01T00:10:00.000Z");
    let recovered = false;
    const watching: SignatureVerifier = {
      recover: async () => {
        recovered = true;
        return ADDRESS;
      },
    };

    await expect(
      assertChallengeSigned(challenge(), "0xsig", watching, late),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(recovered).toBe(false);
  });

  test("expiry is inclusive at the boundary", () => {
    expect(isChallengeExpired(challenge(), new Date("2026-01-01T00:09:59.999Z"))).toBe(false);
    expect(isChallengeExpired(challenge(), new Date("2026-01-01T00:10:00.000Z"))).toBe(true);
  });
});
