/**
 * Turnkey wallet provider tests (#11).
 *
 * Provisioning is live I/O — a sub-organization, a policy, a Safe deployment —
 * so what is asserted here is what happens *before* any of it: the refusals,
 * and the determinism the resumable provisioning path depends on. The
 * deployment itself is proven by running it against Base Sepolia, and the
 * provider verifies its own result on-chain: it reads the signer set back at
 * the deployment block and throws unless the merchant is in it at threshold 1.
 */

import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "@mayarin/shared";
import type { ProvisionRequest } from "@mayarin/wallet";
import { custom, encodeAbiParameters } from "viem";
import { SAFE_BASE_SEPOLIA, TurnkeyWalletProvider } from "../src/wallet-provider.ts";

const MERCHANT_SIGNER = "0x1111111111111111111111111111111111111111";
const MANAGED_SIGNER = {
  ref: "sub-org-1",
  address: "0x2222222222222222222222222222222222222222",
};

/**
 * A provider whose chain is a stub. `proxyCreationCode` is the only call the
 * derivation makes, so it can be exercised without a node — and it is the
 * derivation, not the transport, that decides whether a resumed provision lands
 * on the Safe the first attempt was making.
 *
 * The Turnkey side is a `fetchFn` that throws: every case here is refused, or
 * answered, before a single Turnkey request would be made.
 */
function provider() {
  const transport = custom({
    request: async ({ method }: { method: string }) => {
      if (method === "eth_call") {
        // A stand-in for Safe's proxy creation code. Its value does not matter
        // to these assertions; that it is the *same* value every time does.
        return encodeAbiParameters([{ type: "bytes" }], [`0x${"60".repeat(32)}`]);
      }
      throw new Error(`unexpected RPC call: ${method}`);
    },
  });

  return new TurnkeyWalletProvider({
    organizationId: "org",
    stamper: { stamp: async () => "stamp" },
    chain: "base-sepolia",
    deployerPrivateKey: `0x${"11".repeat(32)}`,
    rpcUrl: "http://rpc.invalid",
    safe: SAFE_BASE_SEPOLIA,
    transport,
    rootApiPublicKey: "root-public-key",
    signerApiPublicKey: "signer-public-key",
    fetchFn: (() => {
      throw new Error("no Turnkey call belongs in this test");
    }) as unknown as typeof fetch,
  });
}

function request(overrides: Partial<ProvisionRequest> = {}): ProvisionRequest {
  return {
    merchantId: "mrc_1",
    chain: "base-sepolia",
    merchantSigner: MERCHANT_SIGNER,
    managedSigner: MANAGED_SIGNER,
    ...overrides,
  };
}

describe("predictAddress", () => {
  test("is the same answer every time for one merchant", async () => {
    // The property the resumable provisioning path rests on: a second attempt
    // derives the address the first one was deploying, and adopts it, instead
    // of deploying the merchant a second Safe.
    const first = await provider().predictAddress(request());
    const second = await provider().predictAddress(request());

    expect(first).toBe(second);
    expect(first).toMatch(/^0x[0-9a-f]{40}$/);
  });

  test("differs per merchant", async () => {
    const one = await provider().predictAddress(request({ merchantId: "mrc_1" }));
    const two = await provider().predictAddress(request({ merchantId: "mrc_2" }));

    expect(one).not.toBe(two);
  });

  test("differs when the signer set differs", async () => {
    // The address is a function of the owners, which is why a resumed
    // provision has to re-derive with the signer it started from.
    const one = await provider().predictAddress(request());
    const two = await provider().predictAddress(
      request({ merchantSigner: "0x3333333333333333333333333333333333333333" }),
    );

    expect(one).not.toBe(two);
  });
});

describe("deploy", () => {
  test("refuses a chain this provider is not deployed on", async () => {
    // One chain, deployed and proven, before the address-derivation questions
    // multiply. A silent wrong-chain deployment is a Safe nobody can reach.
    await expect(provider().deploy(request({ chain: "base" }))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("refuses without the merchant's own signer", async () => {
    // A Safe that starts Mayarin-only and gains a merchant key later was
    // custodial for the window in between.
    await expect(provider().deploy(request({ merchantSigner: "" }))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("refuses a malformed merchant signer", async () => {
    await expect(provider().deploy(request({ merchantSigner: "0xnope" }))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });
});

describe("propose", () => {
  test("refuses rather than approximating a movement it cannot make", async () => {
    // The policy admits the signature; the gas does not exist. That is #9.
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
