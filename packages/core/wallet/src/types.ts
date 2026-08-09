/**
 * Merchant wallets (#11).
 *
 * Where a merchant is paid on-chain, and — the part that did not exist before —
 * *what this system knows about how that address got there*.
 *
 * `merchants.settlement_address` has always held the address. It has never held
 * any claim about who controls it. That was survivable while the only way to
 * set one was a `psql` session; #95 made it an authenticated API call, so a
 * merchant can now name any address at all and the order signer will sign a
 * payment to it. Naming the provenance is what lets the signer refuse.
 */

import type { ChainId } from "@mayarin/chain";

/**
 * How a wallet came to be a merchant's.
 *
 * - `linked` — the merchant supplied an address they say they control.
 * - `passkey` — a key created for them that only their own authenticator can
 *   use. Mayarin asked a provider to make it and never held it.
 * - `provisioned` — Mayarin created it for them, with the merchant in the
 *   signer set from the start.
 *
 * The first two are *merchant-held*: whatever signs for them is something the
 * merchant has, and Mayarin cannot produce a signature for either. That is the
 * distinction `isMerchantHeld` names, and it is the one provisioning cares
 * about — a managed wallet's signer set needs a key the merchant holds, and it
 * does not care which of the two ways they came to hold it.
 */
export const WALLET_PROVENANCES = ["linked", "passkey", "provisioned"] as const;

export type WalletProvenance = (typeof WALLET_PROVENANCES)[number];

/**
 * A wallet a merchant is paid into.
 *
 * `verifiedAt` is the whole point. An address that has not been verified is an
 * address the merchant *claimed*, and a claim is not a basis for signing an
 * order that moves money there.
 */
export interface MerchantWallet {
  readonly id: string;
  readonly merchantId: string;
  readonly chain: ChainId;
  /** Lowercase `0x`-prefixed. */
  readonly address: string;
  readonly provenance: WalletProvenance;
  /**
   * When control of the address was demonstrated, if it ever was.
   *
   * Absent means unverified — the wallet is on file and is not a payout
   * destination. A provisioned wallet is verified by construction: Mayarin
   * created it and put the merchant in the signer set.
   */
  readonly verifiedAt?: Date;
  /**
   * The provider signer this wallet was built around, for a `provisioned` one.
   *
   * Written *before* the wallet is deployed. That is what makes an interrupted
   * provision resumable: the signer already exists, the address is derived from
   * it, and a resumed attempt re-derives the same address rather than creating
   * a second signer and a second wallet.
   */
  readonly managed?: ManagedSignerRecord;
  /**
   * The provider's handle for a key the *merchant* holds — a Turnkey
   * sub-organization whose only root user is their passkey.
   *
   * Present on a `passkey` wallet and nothing else. Stored because signing with
   * that key is a request the merchant's browser makes directly to the
   * provider, and it has to name the organization the key lives in; Mayarin
   * knows the handle and still cannot use it, because using it needs the
   * authenticator.
   */
  readonly keyRef?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * What a managed wallet's address was derived from.
 *
 * Both signers, not just the provider's: the address is a function of the whole
 * signer set, so a resumed provision that used a different merchant signer
 * would derive a different address and deploy a second wallet.
 */
export interface ManagedSignerRecord {
  /** Provider-side handle — a Turnkey sub-organization id today. */
  readonly ref: string;
  /** The provider's signer in the wallet's signer set. Lowercase `0x`. */
  readonly address: string;
  /** The merchant's own verified address in that set. Lowercase `0x`. */
  readonly merchantSigner: string;
}

export function isVerified(wallet: MerchantWallet): boolean {
  return wallet.verifiedAt !== undefined;
}

/**
 * True when whatever signs for this wallet is something the merchant holds.
 *
 * Written as "not provisioned" rather than a list, so a provenance added later
 * is merchant-held unless it is deliberately excluded. The failure that matters
 * is the other direction: treating a Mayarin-provisioned Safe as the merchant's
 * own key would build a signer set out of Mayarin's own signer twice over, and
 * the wallet would be custodial while looking exactly like one that is not.
 */
export function isMerchantHeld(wallet: MerchantWallet): boolean {
  return wallet.provenance !== "provisioned";
}

/**
 * A managed wallet whose deployment never finished.
 *
 * The record is written before the wallet is deployed, so this is the state a
 * crash leaves behind — and the state a resumed provision picks up from.
 */
export function isPendingManaged(wallet: MerchantWallet): boolean {
  return wallet.provenance === "provisioned" && wallet.verifiedAt === undefined;
}

export interface MerchantWalletRepository {
  insert(wallet: MerchantWallet): Promise<void>;
  update(wallet: MerchantWallet): Promise<void>;
  findById(id: string): Promise<MerchantWallet | null>;
  /**
   * The merchant's managed wallet on one chain, deployed or half-provisioned.
   *
   * Asked for by provenance rather than "their wallet on this chain", because a
   * merchant can hold both a linked address and a managed one at once — that
   * pairing is the point of connect-existing living alongside managed.
   */
  findManaged(merchantId: string, chain: ChainId): Promise<MerchantWallet | null>;
  /** Whoever holds this address on this chain — used to refuse a duplicate claim. */
  findByAddress(chain: ChainId, address: string): Promise<MerchantWallet | null>;
  listByMerchant(merchantId: string): Promise<readonly MerchantWallet[]>;
}
