/**
 * A key the merchant holds, for a merchant who holds nothing yet (#11).
 *
 * ## The gap this closes
 *
 * Provisioning a managed Safe needs a merchant-controlled signer, and until now
 * the only way to get one was for the merchant to already have a wallet and
 * sign a challenge with it. That is fine for a merchant who has MetaMask. It is
 * the whole problem for the merchant this product exists for: they are asked to
 * acquire a wallet, understand a seed phrase and keep it safe before they can
 * take their first payment. "Merchants never connect MetaMask" was the claim,
 * and connect-existing was the only path, so the claim was not true.
 *
 * So there is a second way to end up holding a key: **ask a provider to create
 * one that only the merchant's own authenticator can use.** A passkey — a
 * WebAuthn credential in their phone or laptop's secure element — is the
 * authenticator. The signing key itself is generated inside the provider's
 * enclave, bound to that credential, and Mayarin is not a user of the
 * organization it lives in.
 *
 * ## Why this is not custody with extra steps
 *
 * Mayarin asks for the key to be created, so the honest question is whether
 * Mayarin can then use it. Two things have to hold, and both are the adapter's
 * job to enforce rather than this port's to assert:
 *
 * 1. **Mayarin is not a root user of the organization the key lives in.** The
 *    merchant's passkey is, and it is the only one. A parent organization that
 *    creates a sub-organization does not thereby gain authority inside it.
 * 2. **Nothing here returns key material.** The result is an address and a
 *    handle. A method that returned a private key, an export bundle or a
 *    mnemonic would make every sentence above false, which is why there is no
 *    such method to call.
 *
 * The trust assumption is stated plainly because it moved rather than
 * disappeared: with connect-existing, the merchant's key was theirs and the
 * question never arose. Here it rests on the provider's enclave honouring its
 * own authentication — the same assumption the settlement path already makes
 * about the same provider. What it does *not* rest on is Mayarin's own
 * discipline, and that is the part that matters, because a boundary held up by
 * discipline is a boundary somebody crosses at 2am.
 *
 * ## Creating a key is still not proof of holding it
 *
 * A wallet from this path is recorded **unverified**, exactly like a linked
 * address, and becomes payable the same way: the merchant signs the challenge
 * from `verification.ts` with the new key, and the signature is recovered and
 * compared. Nothing is taken on construction.
 *
 * That is deliberate, and it is not ceremony. The chain being proved is
 * passkey → provider → key → address, and every link in it is new. A wallet
 * that cannot sign is a Safe owner that cannot act — self-custody that reads
 * correctly in the database and does not exist on-chain. The one moment to find
 * that out is before a Safe is built on top of it.
 */

/**
 * How the merchant's authenticator can be reached.
 *
 * Kept as a small domain vocabulary rather than the provider's enum: `core`
 * depends on nothing concrete, and the adapter is where a name is translated
 * into whatever the provider happens to call it.
 */
export const PASSKEY_TRANSPORTS = ["internal", "hybrid", "usb", "nfc", "ble"] as const;

export type PasskeyTransport = (typeof PASSKEY_TRANSPORTS)[number];

/**
 * A freshly created WebAuthn credential, as the merchant's browser produced it.
 *
 * Opaque to the domain: these fields are passed through to the provider, which
 * validates the attestation. Mayarin does not verify it independently, and
 * nothing is trusted on the strength of it — the address becomes payable on a
 * signature over a challenge this deployment issued, not on this.
 */
export interface PasskeyAttestation {
  /** What the merchant will see this authenticator called. */
  readonly name: string;
  /** The credential's id, base64url. */
  readonly credentialId: string;
  /** The challenge the authenticator signed at creation, base64url. */
  readonly challenge: string;
  /** WebAuthn `clientDataJSON`, base64url. */
  readonly clientDataJson: string;
  /** WebAuthn attestation object, base64url. */
  readonly attestationObject: string;
  readonly transports: readonly PasskeyTransport[];
}

/** What the provider made: an address, and the handle it lives behind. */
export interface MerchantKey {
  /** Provider-side handle — a Turnkey sub-organization id today. */
  readonly ref: string;
  /** The key's Ethereum address, lowercase `0x`. */
  readonly address: string;
}

export interface CreateMerchantKeyRequest {
  readonly merchantId: string;
  readonly attestation: PasskeyAttestation;
}

/**
 * Creates a signing key only the merchant's authenticator can use.
 *
 * Separate from `WalletProvider` on purpose. That port is about the smart
 * account Mayarin deploys and can propose movements within; this one is about a
 * key Mayarin cannot use at all. A deployment can implement one without the
 * other, and keeping them apart is what stops a future method that signs
 * something from landing on the wrong side of the boundary.
 */
export interface MerchantKeyProvider {
  createMerchantKey(request: CreateMerchantKeyRequest): Promise<MerchantKey>;
}
