/**
 * Merchant wallet service (#11).
 *
 * Two ways a merchant ends up with a payable address, behind the merchant's own
 * session. Scoped like every other merchant surface: no method takes a merchant
 * id, so one merchant cannot claim, verify or provision another's wallet.
 *
 * - **Connect-existing** — they link an address and prove control of it by
 *   signing a challenge. Mayarin signs nothing on their behalf, and this path
 *   carries no custody question at all.
 * - **Managed** — Mayarin provisions a smart account with the merchant already
 *   in its signer set. This is what a merchant who has never held a wallet
 *   gets, and it requires the first path to have happened once: the merchant's
 *   verified address is what makes the signer set non-custodial.
 *
 * The two live alongside each other rather than replacing each other. Which one
 * is actually paid is the settlement address, set separately (#95).
 */

import type { ChainId } from "@mayarin/chain";
import {
  type Clock,
  ConfigurationError,
  ConflictError,
  generateId,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import {
  assertChallengeSigned,
  challengeMessage,
  createChallenge,
  type ManagedWalletProvisioner,
  type MerchantWallet,
  type MerchantWalletRepository,
  type SignatureVerifier,
  type WalletChallenge,
  type WalletChallengeRepository,
} from "@mayarin/wallet";
import type { Scope } from "../dto/auth.ts";

export interface WalletServiceOptions {
  readonly wallets: MerchantWalletRepository;
  readonly challenges: WalletChallengeRepository;
  readonly verifier: SignatureVerifier;
  readonly clock: Clock;
  /** How long a merchant has to sign a challenge. */
  readonly challengeTtlSeconds?: number;
  /**
   * Managed provisioning, absent on a deployment with no wallet provider
   * configured. Absent means the endpoint refuses; it never means a merchant
   * quietly gets nothing.
   */
  readonly provisioner?: ManagedWalletProvisioner;
  /**
   * Fee destinations. A merchant may not link one: an address that is both a
   * fee recipient and a payout destination pays that merchant twice, and the
   * ledger shows one payment.
   */
  readonly treasuryAddresses?: readonly string[];
}

const DEFAULT_CHALLENGE_TTL = 600;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export class WalletService {
  readonly #wallets: MerchantWalletRepository;
  readonly #challenges: WalletChallengeRepository;
  readonly #verifier: SignatureVerifier;
  readonly #clock: Clock;
  readonly #ttl: number;
  readonly #provisioner: ManagedWalletProvisioner | undefined;
  readonly #treasury: ReadonlySet<string>;

  constructor(options: WalletServiceOptions) {
    this.#wallets = options.wallets;
    this.#challenges = options.challenges;
    this.#verifier = options.verifier;
    this.#clock = options.clock;
    this.#ttl = options.challengeTtlSeconds ?? DEFAULT_CHALLENGE_TTL;
    this.#provisioner = options.provisioner;
    this.#treasury = new Set(
      (options.treasuryAddresses ?? []).map((address) => address.toLowerCase()),
    );
  }

  async list(scope: Scope): Promise<readonly MerchantWallet[]> {
    return this.#wallets.listByMerchant(scope.merchantId);
  }

  /**
   * Records an address the merchant says they control.
   *
   * Unverified by construction. Linking is a claim; the guard does not accept
   * claims, so this alone does not make the address payable.
   */
  async link(scope: Scope, chain: ChainId, address: string): Promise<MerchantWallet> {
    const normalised = normaliseAddress(address);

    if (this.#treasury.has(normalised)) {
      // Refused here as well as at signing time, because the guard's refusal
      // would arrive at a merchant's first payment rather than at the moment
      // somebody typed the wrong address.
      throw new ValidationError(
        "That address is a fee destination and cannot be a merchant wallet",
        {
          chain,
          address: normalised,
        },
      );
    }

    const claimed = await this.#wallets.findByAddress(chain, normalised);
    if (claimed !== null) {
      // Same answer whoever asks, including the merchant who already owns it:
      // a distinct message would let an address be probed for ownership.
      throw new ConflictError("That address is already claimed", { chain, address: normalised });
    }

    const now = this.#clock.now();
    const wallet: MerchantWallet = {
      id: generateId("wlt", now.getTime()),
      merchantId: scope.merchantId,
      chain,
      address: normalised,
      provenance: "linked",
      createdAt: now,
      updatedAt: now,
    };
    await this.#wallets.insert(wallet);
    return wallet;
  }

  /**
   * Provisions the merchant's managed wallet on a chain, or returns the one
   * they already have.
   *
   * Asking twice is asking once, and an attempt interrupted halfway resumes
   * onto the same wallet — the merchant ends up with exactly one, which is the
   * property that matters when the alternative is a second address a payer
   * might be told to pay into.
   */
  async provision(scope: Scope, chain: ChainId): Promise<MerchantWallet> {
    if (this.#provisioner === undefined) {
      throw new ConfigurationError(
        "This deployment has no wallet provider configured; link an address you control instead",
        { chain },
      );
    }
    return this.#provisioner.provision(scope.merchantId, chain);
  }

  /** Issues the text the merchant signs to prove control. */
  async challenge(
    scope: Scope,
    walletId: string,
  ): Promise<{ challenge: WalletChallenge; message: string }> {
    const wallet = await this.#ownWallet(scope, walletId);

    const challenge = createChallenge({
      merchantId: scope.merchantId,
      chain: wallet.chain,
      address: wallet.address,
      ttlSeconds: this.#ttl,
      now: this.#clock.now(),
    });
    await this.#challenges.insert(challenge);

    return { challenge, message: challengeMessage(challenge) };
  }

  /**
   * Verifies a signature against an outstanding challenge.
   *
   * The challenge is consumed **before** the wallet is marked verified, and the
   * consume is conditional in the database — so two requests racing one
   * signature cannot both succeed.
   */
  async verify(
    scope: Scope,
    walletId: string,
    challengeId: string,
    signature: string,
  ): Promise<MerchantWallet> {
    const wallet = await this.#ownWallet(scope, walletId);
    const challenge = await this.#challenges.findById(challengeId);

    if (
      challenge === null ||
      challenge.merchantId !== scope.merchantId ||
      challenge.address !== wallet.address ||
      challenge.chain !== wallet.chain
    ) {
      throw new NotFoundError("No such verification challenge for this wallet", {
        walletId,
        challengeId,
      });
    }

    await assertChallengeSigned(challenge, signature, this.#verifier, this.#clock);

    if (!(await this.#challenges.consume(challenge.id))) {
      throw new ConflictError("That challenge has already been used", { challengeId });
    }

    const verified: MerchantWallet = {
      ...wallet,
      verifiedAt: this.#clock.now(),
      updatedAt: this.#clock.now(),
    };
    await this.#wallets.update(verified);
    return verified;
  }

  async #ownWallet(scope: Scope, walletId: string): Promise<MerchantWallet> {
    const wallet = await this.#wallets.findById(walletId);
    if (wallet === null || wallet.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Wallet ${walletId} not found`, { id: walletId });
    }
    return wallet;
  }
}

function normaliseAddress(address: string): string {
  const trimmed = address.trim();
  if (!ADDRESS_PATTERN.test(trimmed)) {
    throw new ValidationError("A wallet address must be a 20-byte hex address", {
      address: trimmed,
    });
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === `0x${"0".repeat(40)}`) {
    throw new ValidationError("The zero address cannot receive settlement", {});
  }
  return lowered;
}
