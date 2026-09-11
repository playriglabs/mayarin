/**
 * Provisioning a managed wallet (#11).
 *
 * The claim this exists to make: **a merchant who has never held a wallet ends
 * up self-custodial from their first payment.** Mayarin creates the smart
 * account, and the merchant is in its signer set from the moment it exists.
 *
 * ## Where the merchant's key comes from
 *
 * From the merchant, proven before this runs. Provisioning requires a
 * merchant-held wallet they have already *verified* — an address a signature
 * recovered to. Either way of holding one qualifies: an address they brought
 * (`linked`), or a key created for them that only their passkey can use
 * (`passkey`, see `merchant-key.ts`). What is refused is a signer set built out
 * of a key Mayarin could produce a signature for, because that is custody
 * wearing a merchant's name.
 *
 * The passkey path is what makes this part of onboarding rather than a step for
 * merchants who already own a wallet. It is still not literally one call: the
 * merchant creates a key, proves it signs, and then this runs — which is the
 * earliest moment a non-custodial signer set can be assembled at all.
 *
 * ## Resumability, which is the whole shape of this file
 *
 * Three effects have to happen: create the provider's signer, deploy the
 * wallet, record it. A crash between any two of them must leave the merchant
 * with exactly one wallet — not zero, and above all not two, because a second
 * one is a second address the payer might be told to pay.
 *
 * So the record is written **before** the deployment, addressed by a prediction
 * rather than by a result:
 *
 * 1. `createManagedSigner` — the provider's own signer for this merchant.
 * 2. `predictAddress` — deterministic in that signer and the merchant's, so it
 *    is the same answer on every attempt.
 * 3. persist the row, unverified.
 * 4. `deploy` — adopts whatever is already at the address, so a resumed attempt
 *    is a no-op that checks.
 * 5. mark verified, which is what makes it payable.
 *
 * A crash before step 3 leaves an orphaned provider signer and no wallet; the
 * retry makes a new signer and one wallet. Wasteful, not dangerous. A crash
 * anywhere after step 3 resumes onto the same signer and the same address.
 *
 * ## One address on every chain
 *
 * A merchant has **one** managed address, whichever EVM chains they are paid
 * on. The address is a function of the signer set and a salt, so every chain
 * after the first reuses exactly what the first was built from: the same
 * provider signer, the same merchant signer, and the first chain as the salt.
 * A chain added to the deployment later lands on the same address too — nothing
 * here names a chain.
 *
 * The merchant's signer may have been proved on any chain. Proof of control is
 * a recovered signature, and the key behind an EVM address is the same key on
 * every EVM chain.
 */

import type { ChainId } from "@mayarin/chain";
import { type Clock, generateId, ValidationError } from "@mayarin/shared";
import type { ManagedSigner, ProvisionRequest, WalletProvider } from "./provider.ts";
import {
  isMerchantHeld,
  isVerified,
  type MerchantWallet,
  type MerchantWalletRepository,
} from "./types.ts";

export interface ManagedWalletProvisionerOptions {
  readonly wallets: MerchantWalletRepository;
  readonly provider: WalletProvider;
  readonly clock: Clock;
  /**
   * Fee destinations. A managed wallet must never land on one: a fee recipient
   * that is also a payout destination pays a merchant twice and is invisible in
   * the ledger.
   */
  readonly treasuryAddresses?: readonly string[];
}

export class ManagedWalletProvisioner {
  readonly #wallets: MerchantWalletRepository;
  readonly #provider: WalletProvider;
  readonly #clock: Clock;
  readonly #treasury: ReadonlySet<string>;

  constructor(options: ManagedWalletProvisionerOptions) {
    this.#wallets = options.wallets;
    this.#provider = options.provider;
    this.#clock = options.clock;
    this.#treasury = new Set(
      (options.treasuryAddresses ?? []).map((address) => address.toLowerCase()),
    );
  }

  /**
   * Provisions the merchant's managed wallet on one chain, or returns the one
   * they have there.
   *
   * Idempotent for the caller as well as after a crash: asking twice is asking
   * once. A merchant gets one managed wallet per chain — at the same address on
   * each — which is why the existing one is returned rather than a second one
   * created.
   */
  async provision(merchantId: string, chain: ChainId): Promise<MerchantWallet> {
    const existing = await this.#wallets.findManaged(merchantId, chain);
    if (existing !== null && isVerified(existing)) return existing;

    const wallets = await this.#wallets.listByMerchant(merchantId);
    // What this wallet is derived from: its own record when a previous attempt
    // wrote one, otherwise the merchant's first managed wallet on any chain.
    const first = firstManaged(wallets);
    const derivedFrom = existing?.managed ?? first?.managed;

    const merchantSigner = verifiedMerchantSigner(merchantId, wallets, derivedFrom?.merchantSigner);

    // Reused when it is already on file. Calling the provider again here is how
    // a merchant ends up with two signers and two addresses.
    const managedSigner: ManagedSigner =
      derivedFrom === undefined
        ? await this.#provider.createManagedSigner(merchantId)
        : { ref: derivedFrom.ref, address: derivedFrom.address };

    const request: ProvisionRequest = {
      merchantId,
      chain,
      saltChain: first?.chain ?? chain,
      merchantSigner,
      managedSigner,
    };
    const address = (await this.#provider.predictAddress(request)).toLowerCase();

    if (this.#treasury.has(address)) {
      throw new ValidationError("A managed wallet cannot be provisioned at a treasury address", {
        merchantId,
        address,
      });
    }

    const claimant = await this.#wallets.findByAddress(chain, address);
    if (claimant !== null && claimant.merchantId !== merchantId) {
      // Not reachable from a deterministic derivation over distinct merchant
      // ids, which is exactly why it is checked: if it ever happens, the
      // derivation is wrong and the alternative to failing is paying one
      // merchant into another's wallet.
      throw new ValidationError("The predicted managed address belongs to another merchant", {
        merchantId,
        chain,
        address,
      });
    }

    const now = this.#clock.now();
    const managed = { ...managedSigner, merchantSigner };
    const pending: MerchantWallet =
      existing === null
        ? {
            id: generateId("wlt", now.getTime()),
            merchantId,
            chain,
            address,
            provenance: "provisioned",
            managed,
            createdAt: now,
            updatedAt: now,
          }
        : { ...existing, address, managed, updatedAt: now };

    // Written before the deployment. The row is the thing that makes the next
    // attempt resume rather than start over.
    if (existing === null) {
      await this.#wallets.insert(pending);
    } else {
      await this.#wallets.update(pending);
    }

    await this.#provider.deploy(request);

    // Verified by construction rather than by challenge: Mayarin deployed it
    // with the merchant's own verified address in the signer set, and the
    // provider read that set back off the chain before returning.
    const verifiedAt = this.#clock.now();
    const ready: MerchantWallet = { ...pending, verifiedAt, updatedAt: verifiedAt };
    await this.#wallets.update(ready);
    return ready;
  }
}

/**
 * The merchant's first managed wallet, deployed or half-provisioned, on any
 * chain. Every later chain derives its address from what this one was built of.
 */
function firstManaged(wallets: readonly MerchantWallet[]): MerchantWallet | undefined {
  return wallets
    .filter((wallet) => wallet.provenance === "provisioned" && wallet.managed !== undefined)
    .sort(byCreatedThenAddress)[0];
}

/**
 * The merchant-controlled signer the wallet is built around.
 *
 * A verified merchant-held wallet, and nothing else. An unverified one is an
 * address the merchant *claimed*, and building a signer set out of a claim
 * would let anyone with `settings:manage` name a co-owner of a wallet Mayarin
 * is about to create. Proved on any chain: a recovered signature names a key,
 * and that key controls the address on every EVM chain.
 *
 * Ordered oldest first, so a merchant holding several — a linked address and
 * a passkey key, say — gets the same signer on every attempt. Repository
 * order is not a promise, and a signer that varied between attempts would
 * derive a different address and deploy a second Safe.
 *
 * A wallet derived from an earlier one keeps that signer: the derivation
 * includes it, so taking a different one now would silently move the wallet to
 * a different address.
 */
function verifiedMerchantSigner(
  merchantId: string,
  wallets: readonly MerchantWallet[],
  derivedFrom: string | undefined,
): string {
  const verified = wallets
    .filter((wallet) => isMerchantHeld(wallet) && isVerified(wallet))
    .sort(byCreatedThenAddress);

  const first = verified[0];
  if (first === undefined) {
    throw new ValidationError(
      "Provisioning needs an address the merchant has proved control of; create a passkey wallet or link one, and verify it first",
      { merchantId },
    );
  }

  if (derivedFrom === undefined) return first.address;

  // Falling back to a different signer would derive a different address — the
  // exact failure this whole path is shaped to avoid — so a signer that is no
  // longer verified is a refusal, not a substitution.
  if (!verified.some((wallet) => wallet.address === derivedFrom)) {
    throw new ValidationError(
      "The address your managed wallet was built with is no longer a verified wallet of yours; verify it again to continue",
      { merchantId, merchantSigner: derivedFrom },
    );
  }
  return derivedFrom;
}

/** Oldest first, address as the tiebreak, so the choice never depends on row order. */
function byCreatedThenAddress(left: MerchantWallet, right: MerchantWallet): number {
  const byCreated = left.createdAt.getTime() - right.createdAt.getTime();
  return byCreated === 0 ? left.address.localeCompare(right.address) : byCreated;
}
