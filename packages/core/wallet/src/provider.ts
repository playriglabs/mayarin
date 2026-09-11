/**
 * The wallet provider port (#11).
 *
 * **This port cannot express "sign this payload", and that is its entire
 * design.** The backend proposes a transaction *within a policy*; the provider
 * decides whether the policy admits it. If the port carried a general signing
 * method, the custody boundary would be a convention — and a convention is what
 * gets bypassed at 2am under a deadline, by someone who is not thinking about
 * custody at all.
 *
 * So the refusal is structural: there is no method here that takes bytes and
 * returns a signature. A caller that wants one has to change this file, which
 * is a change a reviewer will see.
 *
 * Turnkey and Tempo sit behind this. Neither is named here — that is the
 * composition root's business.
 */

import type { ChainId } from "@mayarin/chain";
import type { Money } from "@mayarin/shared";
import type { MerchantWallet } from "./types.ts";

/**
 * The only kinds of movement a managed wallet will ever be asked to make.
 *
 * A closed union rather than an open payload: adding a movement is a change to
 * this type, reviewed on its own terms, rather than a new shape slipping
 * through an `unknown`.
 */
export type WalletIntent = {
  /** Move settlement out of the merchant's wallet to a destination they own. */
  readonly kind: "withdraw";
  readonly amount: Money;
  readonly to: string;
};

/**
 * The provider's own signer for one merchant's wallet, and the handle it is
 * reached by.
 *
 * `ref` is opaque here on purpose — a Turnkey sub-organization id today. What
 * matters to the caller is that it is stable, so a second provisioning attempt
 * reuses the signer that already exists instead of creating a second one.
 */
export interface ManagedSigner {
  readonly ref: string;
  /** Lowercase `0x`-prefixed. */
  readonly address: string;
}

export interface ProvisionRequest {
  readonly merchantId: string;
  /** The chain this wallet is deployed on. */
  readonly chain: ChainId;
  /**
   * The chain the wallet's address is derived for — the chain of the merchant's
   * first managed wallet, whichever chain this one is deployed on.
   *
   * Kept apart from `chain` so a merchant has **one** managed address on every
   * EVM chain. The address is a function of the signer set and this salt; with
   * both fixed at the first provision, the same Safe lands at the same address
   * on every chain it is later deployed to.
   */
  readonly saltChain: ChainId;
  /**
   * A merchant-controlled signer, required at provisioning.
   *
   * Not optional, and not added afterwards: a wallet that starts
   * Mayarin-only and gains a merchant key later was custodial for the window in
   * between, and "briefly custodial" is still custodial to anyone who looks.
   */
  readonly merchantSigner: string;
  readonly managedSigner: ManagedSigner;
}

/**
 * Provisioning in three steps rather than one call, because a crash between
 * them must not leave a merchant with two smart accounts.
 *
 * The steps are ordered so the only thing that happens after the caller has
 * persisted its record is the deployment itself, and the deployment is
 * addressed deterministically — so resuming re-derives the same address and
 * adopts whatever is already there.
 */
export interface WalletProvider {
  /**
   * Creates the provider-side signer for this merchant. Keyed by merchant, so a
   * caller that already holds a `ManagedSigner` never calls this again.
   */
  createManagedSigner(merchantId: string): Promise<ManagedSigner>;
  /**
   * The address the wallet will have, computed before it exists.
   *
   * Deterministic in the request: the same merchant, chain and signer set give
   * the same address forever. That is what makes the record writable *before*
   * the deployment, which is what makes an interrupted provision resumable.
   */
  predictAddress(request: ProvisionRequest): Promise<string>;
  /**
   * Deploys the wallet, or adopts the one already at the predicted address.
   *
   * Idempotent by construction rather than by a flag the caller passes: it
   * reads the chain, and a wallet that is already there is verified rather than
   * redeployed.
   */
  deploy(request: ProvisionRequest): Promise<DeployResult>;
  /**
   * Proposes a movement. The provider enforces its policy and may refuse.
   *
   * Returns the submitted transaction's hash, never a signature — a signature
   * handed back to the backend is a signature the backend could have used for
   * something else.
   */
  propose(wallet: MerchantWallet, intent: WalletIntent): Promise<{ readonly txHash: string }>;
}

export interface DeployResult {
  readonly address: string;
  /** False when the wallet was already on-chain and this call only checked it. */
  readonly deployed: boolean;
}
