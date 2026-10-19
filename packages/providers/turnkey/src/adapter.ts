/**
 * Turnkey order signer (RFC #6 — #41).
 *
 * Implements the `OrderSigner` port over Turnkey's `sign_raw_payload`. The
 * quote-signing key is a custody-adjacent trust root — whoever holds it can
 * authorize settlement amounts — so it lives in Turnkey's enclave and is never
 * exported. This adapter hands Turnkey a 32-byte EIP-712 digest and gets back
 * `r`, `s`, `v`.
 *
 * Turnkey was chosen over AWS KMS and a dedicated HSM because the roadmap
 * already names it for wallet infrastructure (RFC #11, #20), so one custody
 * vendor covers both, and because its managed rotation pairs with the
 * contract's timelocked `setSigner`. The rationale and the rotation runbook are
 * in `docs/quote-signing.md`.
 *
 * The digest is computed here rather than sent as a struct: Turnkey signs
 * opaque bytes, and EIP-712 hashing is the quote package's business. That also
 * keeps what Turnkey sees minimal — it never learns the order's contents.
 */

import type { Hex, OrderSigner, OrderTypedData } from "@mayarin/quote";
import { hashTypedData } from "viem";
import { assertTurnkeyKey, signDigest, type TurnkeyKeyOptions } from "./sign-digest.ts";

export interface TurnkeyOrderSignerOptions extends TurnkeyKeyOptions {
  // The contract's `signer` role must equal `signerAddress`, and rotation means
  // changing both — Turnkey side and, via the timelock, on-chain.
}

export class TurnkeyOrderSigner implements OrderSigner {
  readonly #options: TurnkeyKeyOptions;

  constructor(options: TurnkeyOrderSignerOptions) {
    assertTurnkeyKey(options);
    this.#options = options;
  }

  async address(): Promise<Hex> {
    return this.#options.signerAddress;
  }

  async sign(typedData: OrderTypedData): Promise<Hex> {
    return signDigest(this.#options, hashTypedData(typedData));
  }
}
