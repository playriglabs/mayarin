/**
 * Proving control of a wallet (#11).
 *
 * "Verified" has to mean something, or the guard it feeds is theatre. So it
 * means one thing: **whoever holds the address's key signed a challenge this
 * deployment issued.** Not an operator ticking a box, not a support agent
 * believing a merchant — a signature, recovered and compared.
 *
 * The challenge names the merchant, the chain and the address, and carries a
 * nonce and an expiry. All four matter:
 *
 * - Naming the merchant stops a signature obtained for one merchant being
 *   replayed to claim the address for another.
 * - Naming the chain stops a proof on a testnet standing in for mainnet.
 * - The nonce stops a captured signature being reused after the wallet is
 *   unlinked and someone else claims the address.
 * - The expiry bounds how long a leaked signature stays useful.
 */

import type { ChainId } from "@mayarin/chain";
import { type Clock, generateId, ValidationError } from "@mayarin/shared";

/** Recovers the signer of a personal-message signature. Implemented outside core. */
export interface SignatureVerifier {
  /** The address that produced `signature` over `message`, lowercased. */
  recover(message: string, signature: string): Promise<string>;
}

export interface WalletChallenge {
  readonly id: string;
  readonly merchantId: string;
  readonly chain: ChainId;
  readonly address: string;
  readonly nonce: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface WalletChallengeRepository {
  insert(challenge: WalletChallenge): Promise<void>;
  findById(id: string): Promise<WalletChallenge | null>;
  /** Consumed on use, so one signature proves control exactly once. */
  consume(id: string): Promise<boolean>;
}

/**
 * The exact bytes a merchant signs.
 *
 * Human-readable on purpose: a merchant pasting this into a wallet should be
 * able to read what they are agreeing to. A wallet prompt showing opaque hex is
 * a prompt people approve without reading.
 */
export function challengeMessage(challenge: WalletChallenge): string {
  return [
    "Mayarin wallet verification",
    "",
    `Merchant: ${challenge.merchantId}`,
    `Chain: ${challenge.chain}`,
    `Address: ${challenge.address}`,
    `Nonce: ${challenge.nonce}`,
    `Expires: ${challenge.expiresAt.toISOString()}`,
    "",
    "Signing this proves you control this address. It moves no funds.",
  ].join("\n");
}

export interface CreateChallengeInput {
  readonly merchantId: string;
  readonly chain: ChainId;
  readonly address: string;
  readonly ttlSeconds: number;
  readonly now: Date;
}

export function createChallenge(input: CreateChallengeInput): WalletChallenge {
  const createdAt = new Date(input.now);
  return {
    id: generateId("wch", createdAt.getTime()),
    merchantId: input.merchantId,
    chain: input.chain,
    address: input.address.toLowerCase(),
    // The id is a ULID and already unguessable; a separate nonce keeps the
    // signed text independent of how ids happen to be generated.
    nonce: generateId("wnc", createdAt.getTime()),
    expiresAt: new Date(createdAt.getTime() + input.ttlSeconds * 1_000),
    createdAt,
  };
}

export function isChallengeExpired(challenge: WalletChallenge, now: Date): boolean {
  return now.getTime() >= challenge.expiresAt.getTime();
}

/**
 * Checks a signature against a challenge.
 *
 * Throws on every failure rather than returning a verdict: a caller that
 * mishandled a `false` would mark a wallet verified on a bad signature, and
 * that is the one mistake this function exists to prevent.
 */
export async function assertChallengeSigned(
  challenge: WalletChallenge,
  signature: string,
  verifier: SignatureVerifier,
  clock: Clock,
): Promise<void> {
  if (isChallengeExpired(challenge, clock.now())) {
    throw new ValidationError("This verification challenge has expired; request another", {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt.toISOString(),
    });
  }

  let recovered: string;
  try {
    recovered = (await verifier.recover(challengeMessage(challenge), signature)).toLowerCase();
  } catch {
    // A malformed signature is not a different outcome from a wrong one, and
    // saying which would help someone probing.
    throw new ValidationError("The signature does not prove control of this address", {
      challengeId: challenge.id,
    });
  }

  if (recovered !== challenge.address) {
    throw new ValidationError("The signature does not prove control of this address", {
      challengeId: challenge.id,
    });
  }
}
