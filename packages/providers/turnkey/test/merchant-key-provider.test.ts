/**
 * Turnkey merchant-key provider tests (#11).
 *
 * One claim to check, and it lives entirely in the request body: **Mayarin is
 * not a user of the organization holding the merchant's key.** That is not
 * observable from the return value, so these tests read the request the provider
 * sends. A regression here would be invisible in behaviour — every endpoint
 * would keep working, and the key would quietly be one Mayarin could sign with.
 */

import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "@mayarin/shared";
import type { PasskeyAttestation } from "@mayarin/wallet";
import { TurnkeyMerchantKeyProvider } from "../src/merchant-key-provider.ts";

const ATTESTATION: PasskeyAttestation = {
  name: "Rizky's iPhone",
  credentialId: "credential-id",
  challenge: "challenge",
  clientDataJson: "client-data",
  attestationObject: "attestation-object",
  transports: ["internal", "hybrid"],
};

interface Recorded {
  readonly body: Record<string, unknown>;
  readonly stamp: string | undefined;
}

function provider(response: unknown, status = 200) {
  const calls: Recorded[] = [];
  const instance = new TurnkeyMerchantKeyProvider({
    organizationId: "parent-org",
    stamper: { stamp: async () => "stamp" },
    fetchFn: (async (_url: string, init: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init.body)),
        stamp: (init.headers as Record<string, string>)["X-Stamp"],
      });
      return new Response(JSON.stringify(response), { status });
    }) as unknown as typeof fetch,
  });
  return { provider: instance, calls };
}

const CREATED = {
  activity: {
    status: "ACTIVITY_STATUS_COMPLETED",
    result: {
      createSubOrganizationResultV7: {
        subOrganizationId: "merchant-sub-org",
        wallet: { addresses: ["0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"] },
      },
    },
  },
};

/** The single root user of the created organization. */
function rootUser(body: Record<string, unknown>) {
  const parameters = body.parameters as Record<string, unknown>;
  const rootUsers = parameters.rootUsers as Record<string, unknown>[];
  expect(rootUsers).toHaveLength(1);
  return { parameters, user: rootUsers[0] as Record<string, unknown> };
}

describe("createMerchantKey", () => {
  test("the merchant's passkey is the organization's only credential", async () => {
    // The load-bearing assertion of this file. An API key here — root or signer
    // — would be a Mayarin credential inside the organization holding the
    // merchant's own key, and every custody sentence in `merchant-key.ts` would
    // be false while every test still passed.
    const { provider: keys, calls } = provider(CREATED);

    await keys.createMerchantKey({ merchantId: "mrc_1", attestation: ATTESTATION });

    const { parameters, user } = rootUser(calls[0]?.body ?? {});
    expect(user.apiKeys).toEqual([]);
    expect(user.oauthProviders).toEqual([]);
    expect(user.authenticators).toHaveLength(1);
    // Sufficient as well as necessary: one user at a higher threshold is an
    // organization the merchant could never act in.
    expect(parameters.rootQuorumThreshold).toBe(1);
  });

  test("passes the attestation through and maps the transports", async () => {
    const { provider: keys, calls } = provider(CREATED);

    await keys.createMerchantKey({ merchantId: "mrc_1", attestation: ATTESTATION });

    const { user } = rootUser(calls[0]?.body ?? {});
    const authenticator = (user.authenticators as Record<string, unknown>[])[0] ?? {};
    expect(authenticator.authenticatorName).toBe("Rizky's iPhone");
    expect(authenticator.challenge).toBe("challenge");
    expect(authenticator.attestation).toEqual({
      credentialId: "credential-id",
      clientDataJson: "client-data",
      attestationObject: "attestation-object",
      transports: ["AUTHENTICATOR_TRANSPORT_INTERNAL", "AUTHENTICATOR_TRANSPORT_HYBRID"],
    });
  });

  test("asks for one secp256k1 Ethereum account", async () => {
    // A Safe owner is an Ethereum address. A key on another curve would be
    // created, recorded, and unable to sign for the wallet it is meant to own.
    const { provider: keys, calls } = provider(CREATED);

    await keys.createMerchantKey({ merchantId: "mrc_1", attestation: ATTESTATION });

    const { parameters } = rootUser(calls[0]?.body ?? {});
    const wallet = parameters.wallet as Record<string, unknown>;
    expect(wallet.accounts).toEqual([
      {
        curve: "CURVE_SECP256K1",
        pathFormat: "PATH_FORMAT_BIP32",
        path: "m/44'/60'/0'/0/0",
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
      },
    ]);
  });

  test("returns the handle and a lowercased address", async () => {
    // Lowercase because the registry's unique index and the guard both compare
    // that way; a mixed-case address would be refused as an address nobody knows.
    const { provider: keys } = provider(CREATED);

    const key = await keys.createMerchantKey({ merchantId: "mrc_1", attestation: ATTESTATION });

    expect(key).toEqual({
      ref: "merchant-sub-org",
      address: "0xabcdef0123456789abcdef0123456789abcdef01",
    });
  });

  test("stamps the creation request", async () => {
    const { provider: keys, calls } = provider(CREATED);

    await keys.createMerchantKey({ merchantId: "mrc_1", attestation: ATTESTATION });

    expect(calls[0]?.stamp).toBe("stamp");
  });

  test("throws when Turnkey returns no wallet address", async () => {
    // Recording a merchant wallet with no address, or with the string
    // "undefined", would put a row in the registry that can never be paid and
    // never be explained.
    const { provider: keys } = provider({
      activity: {
        status: "ACTIVITY_STATUS_COMPLETED",
        result: { createSubOrganizationResultV7: { subOrganizationId: "merchant-sub-org" } },
      },
    });

    await expect(
      keys.createMerchantKey({ merchantId: "mrc_1", attestation: ATTESTATION }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("throws on a Turnkey error response", async () => {
    const { provider: keys } = provider({ message: "denied" }, 403);

    await expect(
      keys.createMerchantKey({ merchantId: "mrc_1", attestation: ATTESTATION }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("refuses to be built without a parent organization", async () => {
    expect(
      () =>
        new TurnkeyMerchantKeyProvider({
          organizationId: "",
          stamper: { stamp: async () => "stamp" },
        }),
    ).toThrow(ConfigurationError);
  });
});
