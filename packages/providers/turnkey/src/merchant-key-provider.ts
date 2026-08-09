/**
 * A Turnkey sub-organization the merchant alone controls (#11).
 *
 * The sibling of `wallet-provider.ts`, and the mirror image of it. That file
 * creates a sub-organization Mayarin is the root user of, because Mayarin has
 * to be able to co-sign inside the merchant's Safe. This one creates a
 * sub-organization Mayarin is **not a user of at all**:
 *
 * - `rootUsers` is exactly one entry, and its only credential is the merchant's
 *   passkey. No `apiKeys` — not Mayarin's root key, not the settlement signer,
 *   none.
 * - `rootQuorumThreshold` is 1, so that passkey is sufficient as well as
 *   necessary. A threshold of 2 with one user is an organization nobody can act
 *   in.
 *
 * Mayarin's parent-organization key creates it and that is the last thing that
 * key can do here. Creating a sub-organization does not make the parent a user
 * of it, so every subsequent activity — signing, adding an authenticator,
 * exporting — is denied to Mayarin by Turnkey rather than by this code
 * remembering not to ask.
 *
 * That is the claim, and it is the one to attack. What backs it is Turnkey's
 * own authorization model, which the settlement path already relies on for the
 * policy that bounds the signer key. What does not back it is anything in this
 * repository, which is the point: a boundary this file could widen by accident
 * is not a boundary.
 *
 * ## What is deliberately absent
 *
 * No export, no `signRawPayload`, no method that returns key material or a
 * signature. The merchant's browser talks to Turnkey directly, stamping its
 * request with the passkey; the signature comes back to *it*, and reaches
 * Mayarin only as the proof-of-control signature the verification path
 * recovers. A convenience method here that proxied a signing request would put
 * Mayarin on the path of a signature it is not supposed to be able to obtain.
 */

import { ConfigurationError } from "@mayarin/shared";
import type {
  CreateMerchantKeyRequest,
  MerchantKey,
  MerchantKeyProvider,
  PasskeyTransport,
} from "@mayarin/wallet";
import { z } from "zod";
import { DEFAULT_TURNKEY_ENDPOINT } from "./adapter.ts";
import type { TurnkeyStamper } from "./stamper.ts";

/** Domain vocabulary → Turnkey's enum. Kept here so `core` never spells these. */
const TRANSPORTS: Record<PasskeyTransport, string> = {
  internal: "AUTHENTICATOR_TRANSPORT_INTERNAL",
  hybrid: "AUTHENTICATOR_TRANSPORT_HYBRID",
  usb: "AUTHENTICATOR_TRANSPORT_USB",
  nfc: "AUTHENTICATOR_TRANSPORT_NFC",
  ble: "AUTHENTICATOR_TRANSPORT_BLE",
};

const subOrgResponseSchema = z.object({
  activity: z.object({
    status: z.string(),
    result: z
      .object({
        createSubOrganizationResultV7: z
          .object({
            subOrganizationId: z.string(),
            wallet: z.object({ addresses: z.array(z.string()).min(1) }).optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export interface TurnkeyMerchantKeyProviderOptions {
  /** Mayarin's parent organization. It creates the sub-org and is not a user of it. */
  readonly organizationId: string;
  /** Stamps the creation request. The only Mayarin credential involved. */
  readonly stamper: TurnkeyStamper;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export class TurnkeyMerchantKeyProvider implements MerchantKeyProvider {
  readonly #options: TurnkeyMerchantKeyProviderOptions;

  constructor(options: TurnkeyMerchantKeyProviderOptions) {
    if (options.organizationId.length === 0) {
      throw new ConfigurationError("A merchant key provider needs a parent organization", {});
    }
    this.#options = options;
  }

  async createMerchantKey(request: CreateMerchantKeyRequest): Promise<MerchantKey> {
    const { attestation } = request;
    const body = JSON.stringify({
      type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V7",
      timestampMs: String(Date.now()),
      organizationId: this.#options.organizationId,
      parameters: {
        subOrganizationName: `merchant-key-${request.merchantId}`,
        rootUsers: [
          {
            userName: `merchant-${request.merchantId}`,
            // Empty on purpose, and the single most important line in this
            // file: an API key here would be a Mayarin credential inside the
            // organization holding the merchant's own key.
            apiKeys: [],
            authenticators: [
              {
                authenticatorName: attestation.name,
                challenge: attestation.challenge,
                attestation: {
                  credentialId: attestation.credentialId,
                  clientDataJson: attestation.clientDataJson,
                  attestationObject: attestation.attestationObject,
                  transports: attestation.transports.map((transport) => TRANSPORTS[transport]),
                },
              },
            ],
            oauthProviders: [],
          },
        ],
        // One user, sufficient on its own. Anything higher is an organization
        // with no quorum, and the merchant could never sign.
        rootQuorumThreshold: 1,
        wallet: {
          walletName: `merchant-key-${request.merchantId}`,
          accounts: [
            {
              curve: "CURVE_SECP256K1",
              pathFormat: "PATH_FORMAT_BIP32",
              path: "m/44'/60'/0'/0/0",
              addressFormat: "ADDRESS_FORMAT_ETHEREUM",
            },
          ],
        },
      },
    });

    const parsed = subOrgResponseSchema.safeParse(
      await this.#post("/public/v1/submit/create_sub_organization", body),
    );
    const result = parsed.success
      ? parsed.data.activity.result?.createSubOrganizationResultV7
      : undefined;
    const address = result?.wallet?.addresses[0];

    if (result === undefined || address === undefined) {
      throw new ConfigurationError("Turnkey did not return a merchant key", {
        merchantId: request.merchantId,
      });
    }

    return { ref: result.subOrganizationId, address: address.toLowerCase() };
  }

  async #post(path: string, body: string): Promise<unknown> {
    const fetchFn = this.#options.fetchFn ?? fetch;
    const response = await fetchFn(`${this.#options.endpoint ?? DEFAULT_TURNKEY_ENDPOINT}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stamp": await this.#options.stamper.stamp(body),
      },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ConfigurationError(`Turnkey ${response.status}`, { body: text.slice(0, 300) });
    }
    return JSON.parse(text);
  }
}
