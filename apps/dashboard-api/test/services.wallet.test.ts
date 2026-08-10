/**
 * Wallet service tests for the paths a route test cannot reach (#11).
 *
 * A deployment with no wallet provider configured. The harness always wires the
 * fakes, so the absent case is exercised here: what matters is that the endpoint
 * *refuses*, rather than the merchant quietly getting something else.
 */

import { describe, expect, test } from "bun:test";
import { InMemoryMerchantRepository } from "@mayarin/auth/testing";
import { ViemSignatureVerifier } from "@mayarin/provider-evm";
import { ConfigurationError, FixedClock } from "@mayarin/shared";
import type { PasskeyAttestation } from "@mayarin/wallet";
import { SettlementAddressResolver } from "@mayarin/wallet";
import {
  InMemoryMerchantWalletRepository,
  InMemoryWalletChallengeRepository,
} from "@mayarin/wallet/testing";
import type { Scope } from "../src/dto/auth.ts";
import { WalletService } from "../src/services/wallet-service.ts";

const NOW = new Date("2026-08-09T00:00:00.000Z");
const SCOPE: Scope = { merchantId: "mrc_1", permissions: new Set(["settings:manage"]) };
const ATTESTATION: PasskeyAttestation = {
  name: "Merchant's phone",
  credentialId: "credential-id",
  challenge: "webauthn-challenge",
  clientDataJson: "client-data",
  attestationObject: "attestation-object",
  transports: ["internal"],
};

/** No provider at all: neither a key provider nor a provisioner. */
function service() {
  const wallets = new InMemoryMerchantWalletRepository();
  return new WalletService({
    wallets,
    challenges: new InMemoryWalletChallengeRepository(),
    verifier: new ViemSignatureVerifier(),
    clock: new FixedClock(NOW),
    merchants: new InMemoryMerchantRepository(),
    chain: "base-sepolia",
    settlementAddresses: new SettlementAddressResolver({ wallets }),
  });
}

describe("a deployment with no wallet provider", () => {
  test("refuses to create a passkey wallet, and says what to do instead", async () => {
    // The alternative would be creating a key some other way, and every other
    // way puts Mayarin in a position to sign with it.
    await expect(
      service().createPasskeyWallet(SCOPE, "base-sepolia", ATTESTATION),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("refuses to provision a managed wallet", async () => {
    await expect(service().provision(SCOPE, "base-sepolia")).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("still links an address the merchant already controls", async () => {
    // Connect-existing needs no provider: a signature is the whole of it.
    const wallet = await service().link(
      SCOPE,
      "base-sepolia",
      "0x1111111111111111111111111111111111111111",
    );

    expect(wallet.provenance).toBe("linked");
    expect(wallet.verifiedAt).toBeUndefined();
  });
});
