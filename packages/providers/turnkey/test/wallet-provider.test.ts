/**
 * Turnkey wallet provider tests (#11).
 *
 * Provisioning is live I/O — a sub-organization and a Safe deployment — so what
 * is asserted here is the refusal that happens before any of it, and the shape
 * of the port. The deployment itself is proven by running it against Base
 * Sepolia, and the provider verifies its own result on-chain: it reads the
 * signer set back at the deployment block and throws unless the merchant is in
 * it at threshold 1.
 */

import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "@mayarin/shared";
import { SAFE_BASE_SEPOLIA, TurnkeyWalletProvider } from "../src/wallet-provider.ts";

function provider() {
  return new TurnkeyWalletProvider({
    organizationId: "org",
    stamper: { stamp: async () => "stamp" },
    deployerPrivateKey: `0x${"11".repeat(32)}`,
    rpcUrl: "http://localhost:0",
    safe: SAFE_BASE_SEPOLIA,
    // Never reached: every case here is refused before any request.
    fetchFn: (() => {
      throw new Error("no network in this test");
    }) as unknown as typeof fetch,
  });
}

describe("provision", () => {
  test("refuses without the merchant's own signer", async () => {
    // A Safe that starts Mayarin-only and gains a merchant key later was
    // custodial for the window in between.
    await expect(
      provider().provision({ merchantId: "mrc_1", chain: "base-sepolia", merchantSigner: "" }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("refuses a malformed merchant signer", async () => {
    await expect(
      provider().provision({
        merchantId: "mrc_1",
        chain: "base-sepolia",
        merchantSigner: "0xnope",
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe("propose", () => {
  test("refuses rather than approximating a movement it cannot make", async () => {
    // Signing a SafeTx with the sub-org key needs the Turnkey policy that
    // bounds it, and gas the merchant does not have. Both are #9.
    await expect(
      provider().propose(
        {
          id: "wlt_1",
          merchantId: "mrc_1",
          chain: "base-sepolia",
          address: "0x1111111111111111111111111111111111111111",
          provenance: "provisioned",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          kind: "withdraw",
          amount: { amount: 1n, asset: "USDC" },
          to: "0x2222222222222222222222222222222222222222",
        },
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe("the Safe deployment table", () => {
  test("names the 1.4.1 contracts verified on Base Sepolia", () => {
    // Checked on-chain with `getCode` before this shipped; a wrong factory
    // deploys nothing, or something else, and the merchant's money follows.
    expect(SAFE_BASE_SEPOLIA.proxyFactory).toBe("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67");
    expect(SAFE_BASE_SEPOLIA.singleton).toBe("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762");
    expect(SAFE_BASE_SEPOLIA.fallbackHandler).toBe("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99");
  });
});
