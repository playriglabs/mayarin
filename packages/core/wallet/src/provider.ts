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

export interface ProvisionRequest {
  readonly merchantId: string;
  readonly chain: ChainId;
  /**
   * A merchant-controlled signer, required at provisioning.
   *
   * Not optional, and not added afterwards: a wallet that starts
   * Mayarin-only and gains a merchant key later was custodial for the window in
   * between, and "briefly custodial" is still custodial to anyone who looks.
   */
  readonly merchantSigner: string;
}

export interface WalletProvider {
  /** Creates a managed wallet with the merchant already in its signer set. */
  provision(request: ProvisionRequest): Promise<MerchantWallet>;
  /**
   * Proposes a movement. The provider enforces its policy and may refuse.
   *
   * Returns the submitted transaction's hash, never a signature — a signature
   * handed back to the backend is a signature the backend could have used for
   * something else.
   */
  propose(wallet: MerchantWallet, intent: WalletIntent): Promise<{ readonly txHash: string }>;
}
