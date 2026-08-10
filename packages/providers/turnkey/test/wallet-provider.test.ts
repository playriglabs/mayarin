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
import { ConfigurationError, ValidationError } from "@mayarin/shared";
import type { MerchantWallet, ProvisionRequest } from "@mayarin/wallet";
import {
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  type Hex,
  parseAbi,
  parseTransaction,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  prevalidatedSignature,
  SAFE_BASE_SEPOLIA,
  TurnkeyWalletProvider,
} from "../src/wallet-provider.ts";

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
const SAFE_ADDRESS = "0x4444444444444444444444444444444444444444";
const DESTINATION = "0x5555555555555555555555555555555555555555";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
/** The key the fake enclave signs with, standing in for the sub-org's. */
const SUB_ORG_KEY = `0x${"44".repeat(32)}` as const;

const SAFE_EXEC_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
]);
const ERC20_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

function wallet(overrides: Partial<MerchantWallet> = {}): MerchantWallet {
  return {
    id: "wlt_1",
    merchantId: "mrc_1",
    chain: "base-sepolia",
    address: SAFE_ADDRESS,
    provenance: "provisioned",
    verifiedAt: new Date(),
    managed: {
      ref: "sub-org-1",
      address: MANAGED_SIGNER.address,
      merchantSigner: MERCHANT_SIGNER,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A wallet the merchant holds themselves — no signer set Mayarin is part of. */
function merchantHeldWallet(): MerchantWallet {
  const { managed, ...rest } = wallet();
  void managed;
  return { ...rest, provenance: "linked", address: DESTINATION };
}

/**
 * A chain and an enclave that answer without a network.
 *
 * The enclave is a real key: it parses the transaction Turnkey was handed and
 * signs it, so the raw transaction the provider broadcasts is one a node would
 * accept. `broadcast` is what a test decodes to see where the money was
 * actually addressed.
 */
function fakeChain() {
  const account = privateKeyToAccount(SUB_ORG_KEY);
  const state: {
    broadcast: Hex | undefined;
    signRequest: { organizationId?: string; parameters?: unknown } | undefined;
    transport: Transport;
    fetchFn: typeof fetch;
  } = {
    broadcast: undefined,
    signRequest: undefined,
    transport: custom({
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case "eth_chainId":
            return "0x14a34";
          case "eth_estimateGas":
            return "0x186a0";
          case "eth_getBlockByNumber":
            return { baseFeePerGas: "0x3b9aca00", number: "0x1", hash: `0x${"11".repeat(32)}` };
          case "eth_maxPriorityFeePerGas":
            return "0x3b9aca00";
          case "eth_getBalance":
            // Funded already, so the top-up path is not what these assert.
            return "0xde0b6b3a7640000";
          case "eth_getTransactionCount":
            return "0x0";
          case "eth_sendRawTransaction":
            state.broadcast = (params?.[0] ?? "0x") as Hex;
            return `0x${"ab".repeat(32)}`;
          case "eth_getTransactionReceipt":
            return {
              status: "0x1",
              transactionHash: `0x${"ab".repeat(32)}`,
              blockNumber: "0x1",
              blockHash: `0x${"11".repeat(32)}`,
              transactionIndex: "0x0",
              gasUsed: "0x186a0",
              cumulativeGasUsed: "0x186a0",
              effectiveGasPrice: "0x3b9aca00",
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              type: "0x2",
              from: MANAGED_SIGNER.address,
              to: SAFE_ADDRESS,
              contractAddress: null,
            };
          default:
            throw new Error(`unexpected RPC call: ${method}`);
        }
      },
    }),
    fetchFn: (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as {
        organizationId?: string;
        parameters?: { unsignedTransaction?: string };
      };
      state.signRequest = body;
      const unsigned = `0x${body.parameters?.unsignedTransaction ?? ""}` as Hex;
      const signed = await account.signTransaction(parseTransaction(unsigned) as never);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            activity: {
              status: "COMPLETED",
              result: { signTransactionResult: { signedTransaction: signed } },
            },
          }),
      };
    }) as unknown as typeof fetch,
  };

  return state;
}

function provider(overrides: { transport?: Transport; fetchFn?: typeof fetch } = {}) {
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
    transport: overrides.transport ?? transport,
    rootApiPublicKey: "root-public-key",
    signerApiPublicKey: "signer-public-key",
    tokens: { USDC },
    nativeAsset: "ETH",
    fetchFn:
      overrides.fetchFn ??
      ((() => {
        throw new Error("no Turnkey call belongs in this test");
      }) as unknown as typeof fetch),
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
  test("refuses a wallet Mayarin never provisioned", async () => {
    // Nothing else here has a signer set Mayarin is part of, so there is no key
    // that could move it — and a merchant-held wallet moves in their own wallet.
    await expect(
      provider().propose(merchantHeldWallet(), {
        kind: "withdraw",
        amount: { amount: 1n, asset: "USDC" },
        to: DESTINATION,
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("refuses a non-positive amount", async () => {
    await expect(
      provider().propose(wallet(), {
        kind: "withdraw",
        amount: { amount: 0n, asset: "USDC" },
        to: DESTINATION,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("refuses an asset with no token address configured", async () => {
    // The alternative is guessing a contract address, and the wrong one moves
    // somebody else's token or nothing at all.
    await expect(
      provider().propose(wallet(), {
        kind: "withdraw",
        amount: { amount: 1n, asset: "IDRX" },
        to: DESTINATION,
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("sends the Safe an execTransaction carrying the ERC-20 transfer", async () => {
    // The whole custody argument rests on this shape: the transaction goes *to*
    // the merchant's Safe, which is the condition the Turnkey policy checks, and
    // the token transfer rides inside it rather than being signed on its own.
    const chain = fakeChain();
    const signed = await provider({ transport: chain.transport, fetchFn: chain.fetchFn }).propose(
      wallet(),
      { kind: "withdraw", amount: { amount: 2_500_000n, asset: "USDC" }, to: DESTINATION },
    );

    expect(signed.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const sent = parseTransaction(chain.broadcast ?? "0x");
    expect(sent.to?.toLowerCase()).toBe(SAFE_ADDRESS);
    const call = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: sent.data ?? "0x" });
    expect(call.args[0].toLowerCase()).toBe(USDC);
    expect(call.args[1]).toBe(0n);
    const transfer = decodeFunctionData({ abi: ERC20_ABI, data: call.args[2] });
    expect(transfer.args).toEqual([getAddress(DESTINATION), 2_500_000n]);
  });

  test("signs with the merchant's sub-organization, not Mayarin's", async () => {
    // A signature from the parent organization would be Mayarin's own key
    // moving the money, which is the thing the sub-org exists to prevent.
    const chain = fakeChain();
    await provider({ transport: chain.transport, fetchFn: chain.fetchFn }).propose(wallet(), {
      kind: "withdraw",
      amount: { amount: 1n, asset: "USDC" },
      to: DESTINATION,
    });

    expect(chain.signRequest?.organizationId).toBe("sub-org-1");
    const parameters = chain.signRequest?.parameters as { signWith: string } | undefined;
    expect(parameters?.signWith.toLowerCase()).toBe(MANAGED_SIGNER.address);
  });

  test("moves the chain's own currency by value rather than by a token call", async () => {
    const chain = fakeChain();
    await provider({ transport: chain.transport, fetchFn: chain.fetchFn }).propose(wallet(), {
      kind: "withdraw",
      amount: { amount: 10n ** 15n, asset: "ETH" },
      to: DESTINATION,
    });

    const sent = parseTransaction(chain.broadcast ?? "0x");
    const call = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: sent.data ?? "0x" });
    expect(call.args[0].toLowerCase()).toBe(DESTINATION);
    expect(call.args[1]).toBe(10n ** 15n);
    expect(call.args[2]).toBe("0x");
  });
});

describe("prevalidatedSignature", () => {
  test("is the owner's address, an empty s, and v = 1", () => {
    // Safe reads `v == 1` as "the caller is this owner" and checks no digest.
    // It authorizes nothing in anyone else's hands, which is why the sub-org
    // key has to be the sender.
    const signature = prevalidatedSignature(getAddress(MANAGED_SIGNER.address));

    expect(signature).toBe(
      `0x${"00".repeat(12)}${MANAGED_SIGNER.address.slice(2)}${"00".repeat(32)}01`,
    );
    expect(signature).toHaveLength(2 + 65 * 2);
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
