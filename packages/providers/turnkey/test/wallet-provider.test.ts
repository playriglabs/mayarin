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
import type { ChainId } from "@mayarin/chain";
import { ConfigurationError, ProviderError, ValidationError } from "@mayarin/shared";
import type { MerchantWallet, ProvisionRequest } from "@mayarin/wallet";
import {
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  type Hex,
  keccak256,
  parseAbi,
  parseTransaction,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  prevalidatedSignature,
  SAFE_1_4_1,
  type SafeDeployment,
  TurnkeyWalletProvider,
} from "../src/wallet-provider.ts";

/**
 * Stand-in runtime code for the three Safe contracts, and a deployment that
 * expects exactly it. The provider matches code hashes before deriving; what is
 * under test is that it does, not Safe's real bytecode.
 */
const STUB_CODE = "0x6080" as const;
const STUB_SAFE: SafeDeployment = {
  ...SAFE_1_4_1,
  codeHashes: {
    proxyFactory: keccak256(STUB_CODE),
    singleton: keccak256(STUB_CODE),
    fallbackHandler: keccak256(STUB_CODE),
  },
};

const STUB_MULTI_SEND = {
  address: "0x6666666666666666666666666666666666666666",
  codeHash: keccak256(STUB_CODE),
} as const;

/** What the fake pricing charges for gas, in the token's minor units. */
const FEE = 1_000n;
const gasFee = async () => FEE;
/** The deployer key `provider()` is built with, which is where the fee goes. */
const DEPLOYER = privateKeyToAccount(`0x${"11".repeat(32)}`).address;

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
const MULTI_SEND_ABI = parseAbi(["function multiSend(bytes transactions)"]);

interface Leg {
  readonly to: string;
  readonly value: bigint;
  readonly data: Hex;
}

/** The legs of a broadcast withdrawal, unpacked from `MultiSendCallOnly`'s packed encoding. */
function legsOf(broadcast: Hex | undefined) {
  const sent = parseTransaction(broadcast ?? "0x");
  const exec = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: sent.data ?? "0x" });
  const batch = decodeFunctionData({ abi: MULTI_SEND_ABI, data: exec.args[2] });
  const packed = batch.args[0];
  const legs: Leg[] = [];
  let at = 2;
  while (at < packed.length) {
    const to = `0x${packed.slice(at + 2, at + 42)}`;
    const value = BigInt(`0x${packed.slice(at + 42, at + 106)}`);
    const size = Number(BigInt(`0x${packed.slice(at + 106, at + 170)}`)) * 2;
    const data = `0x${packed.slice(at + 170, at + 170 + size)}` as Hex;
    legs.push({ to, value, data });
    at += 170 + size;
  }
  return { sent, exec, legs };
}

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
function fakeChain(l1Fee = 0n, balance = "0xde0b6b3a7640000") {
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
          case "eth_getCode":
            return STUB_CODE;
          case "eth_call":
            // The only call a withdrawal makes: the OP-stack oracle's `getL1Fee`.
            return encodeAbiParameters([{ type: "uint256" }], [l1Fee]);
          case "eth_estimateGas":
            return "0x186a0";
          case "eth_getBlockByNumber":
            return { baseFeePerGas: "0x3b9aca00", number: "0x1", hash: `0x${"11".repeat(32)}` };
          case "eth_maxPriorityFeePerGas":
            return "0x3b9aca00";
          case "eth_getBalance":
            // Funded already unless a test says otherwise, so the top-up path is
            // not what most of these assert. Once anything has been broadcast
            // (the top-up), the signer holds plenty.
            return state.broadcast === undefined ? balance : "0xde0b6b3a7640000";
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

function provider(
  overrides: {
    transport?: Transport;
    fetchFn?: typeof fetch;
    chain?: ChainId;
    safeCode?: Hex;
    gasFee?: (input: { cost: bigint; asset: string }) => Promise<bigint>;
    multiSend?: { address: `0x${string}`; codeHash: Hex };
  } = {},
) {
  const transport = custom({
    request: async ({ method }: { method: string }) => {
      if (method === "eth_call") {
        // A stand-in for Safe's proxy creation code. Its value does not matter
        // to these assertions; that it is the *same* value every time does.
        return encodeAbiParameters([{ type: "bytes" }], [`0x${"60".repeat(32)}`]);
      }
      if (method === "eth_getCode") return overrides.safeCode ?? STUB_CODE;
      throw new Error(`unexpected RPC call: ${method}`);
    },
  });

  return new TurnkeyWalletProvider({
    organizationId: "org",
    stamper: { stamp: async () => "stamp" },
    chain: overrides.chain ?? "base-sepolia",
    deployerPrivateKey: `0x${"11".repeat(32)}`,
    rpcUrl: "http://rpc.invalid",
    safe: STUB_SAFE,
    multiSend: overrides.multiSend ?? STUB_MULTI_SEND,
    gasFee: overrides.gasFee ?? gasFee,
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
    saltChain: "base-sepolia",
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

  test("is keyed by the salt chain, not the chain it is deployed on", async () => {
    // One managed address on every chain: the same request on Base and on Arc
    // must derive the same address, or a merchant is handed one per network.
    const onBase = await provider({ chain: "base-sepolia" }).predictAddress(
      request({ chain: "base-sepolia", saltChain: "base-sepolia" }),
    );
    const onArc = await provider({ chain: "arc-testnet" }).predictAddress(
      request({ chain: "arc-testnet", saltChain: "base-sepolia" }),
    );
    const otherSalt = await provider({ chain: "arc-testnet" }).predictAddress(
      request({ chain: "arc-testnet", saltChain: "arc-testnet" }),
    );

    expect(onArc).toBe(onBase);
    expect(otherSalt).not.toBe(onBase);
  });

  test("refuses a chain without the canonical Safe contracts, before deriving", async () => {
    // A chain that never ran Safe's deterministic deployment — or derives
    // CREATE2 differently — has no matching code. A prediction there is an
    // address nothing can ever be deployed to.
    await expect(
      provider({ chain: "arbitrum-sepolia", safeCode: "0x" }).predictAddress(
        request({ chain: "arbitrum-sepolia" }),
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
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
        amount: { amount: 1n, asset: "USDT" },
        to: DESTINATION,
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  test("sends the Safe one batched call: the amount less the fee to the destination, the fee to the deployer", async () => {
    // The whole custody argument rests on this shape: the transaction goes *to*
    // the merchant's Safe, which is the condition the Turnkey policy checks, and
    // the transfers ride inside it rather than being signed on their own.
    const chain = fakeChain();
    const result = await provider({ transport: chain.transport, fetchFn: chain.fetchFn }).propose(
      wallet(),
      { kind: "withdraw", amount: { amount: 2_500_000n, asset: "USDC" }, to: DESTINATION },
    );

    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.networkFee).toEqual({ amount: FEE, asset: "USDC" });
    const { sent, exec, legs } = legsOf(chain.broadcast);
    expect(sent.to?.toLowerCase()).toBe(SAFE_ADDRESS);
    // A DELEGATECALL into the matched MultiSend, and nowhere else.
    expect(exec.args[0].toLowerCase()).toBe(STUB_MULTI_SEND.address);
    expect(exec.args[3]).toBe(1);

    expect(legs).toHaveLength(2);
    const [net, fee] = legs as [Leg, Leg];
    expect(net.to.toLowerCase()).toBe(USDC);
    expect(decodeFunctionData({ abi: ERC20_ABI, data: net.data }).args).toEqual([
      getAddress(DESTINATION),
      2_500_000n - FEE,
    ]);
    expect(fee.to.toLowerCase()).toBe(USDC);
    expect(decodeFunctionData({ abi: ERC20_ABI, data: fee.data }).args).toEqual([DEPLOYER, FEE]);
  });

  test("the L1 data fee of an OP-stack chain is part of what the merchant repays", async () => {
    // A node refuses a transaction whose sender cannot cover gas * price *and*
    // the L1 fee, so the signer is funded for both, and both are in the fee.
    const l1Fee = 1_000_000n;
    const chain = fakeChain(l1Fee);
    const costs: bigint[] = [];
    await provider({
      transport: chain.transport,
      fetchFn: chain.fetchFn,
      gasFee: async ({ cost }) => {
        costs.push(cost);
        return FEE;
      },
    }).propose(wallet(), {
      kind: "withdraw",
      amount: { amount: 2_500_000n, asset: "USDC" },
      to: DESTINATION,
    });

    const withoutL1 = fakeChain(0n);
    const baseline: bigint[] = [];
    await provider({
      transport: withoutL1.transport,
      fetchFn: withoutL1.fetchFn,
      gasFee: async ({ cost }) => {
        baseline.push(cost);
        return FEE;
      },
    }).propose(wallet(), {
      kind: "withdraw",
      amount: { amount: 2_500_000n, asset: "USDC" },
      to: DESTINATION,
    });

    // Twice the oracle's figure, on top of the L2 cost.
    expect((costs[0] ?? 0n) - (baseline[0] ?? 0n)).toBe(l1Fee * 2n);
  });

  test("the gas of the signer's top-up is repaid too, when one is sent", async () => {
    // Mayarin does not eat the deployer's own transaction: funded signer pays
    // nothing extra, an empty one adds 21,000 gas to what the merchant owes.
    const owed = async (balance: string) => {
      const chain = fakeChain(0n, balance);
      const costs: bigint[] = [];
      await provider({
        transport: chain.transport,
        fetchFn: chain.fetchFn,
        gasFee: async ({ cost }) => {
          costs.push(cost);
          return FEE;
        },
      }).propose(wallet(), {
        kind: "withdraw",
        amount: { amount: 2_500_000n, asset: "USDC" },
        to: DESTINATION,
      });
      return costs[0] ?? 0n;
    };

    const funded = await owed("0xde0b6b3a7640000");
    const empty = await owed("0x0");

    // viem's maxFeePerGas here: 1.2 x the 1 gwei base fee + the 1 gwei tip.
    expect(empty - funded).toBe(21_000n * 2_200_000_000n);
  });

  test("refuses an amount the network fee would consume", async () => {
    const chain = fakeChain();
    await expect(
      provider({ transport: chain.transport, fetchFn: chain.fetchFn }).propose(wallet(), {
        kind: "withdraw",
        amount: { amount: FEE, asset: "USDC" },
        to: DESTINATION,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("refuses to run free when the fee cannot be priced", async () => {
    const chain = fakeChain();
    await expect(
      provider({
        transport: chain.transport,
        fetchFn: chain.fetchFn,
        gasFee: async () => 0n,
      }).propose(wallet(), {
        kind: "withdraw",
        amount: { amount: 2_500_000n, asset: "USDC" },
        to: DESTINATION,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(chain.broadcast).toBeUndefined();
  });

  test("refuses a chain whose MultiSendCallOnly is not Safe's", async () => {
    const chain = fakeChain();
    await expect(
      provider({
        transport: chain.transport,
        fetchFn: chain.fetchFn,
        multiSend: { ...STUB_MULTI_SEND, codeHash: keccak256("0xdead") },
      }).propose(wallet(), {
        kind: "withdraw",
        amount: { amount: 2_500_000n, asset: "USDC" },
        to: DESTINATION,
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(chain.broadcast).toBeUndefined();
  });

  test("signs with the merchant's sub-organization, not Mayarin's", async () => {
    // A signature from the parent organization would be Mayarin's own key
    // moving the money, which is the thing the sub-org exists to prevent.
    const chain = fakeChain();
    await provider({ transport: chain.transport, fetchFn: chain.fetchFn }).propose(wallet(), {
      kind: "withdraw",
      amount: { amount: 2_500_000n, asset: "USDC" },
      to: DESTINATION,
    });

    expect(chain.signRequest?.organizationId).toBe("sub-org-1");
    const parameters = chain.signRequest?.parameters as { signWith: string } | undefined;
    expect(parameters?.signWith.toLowerCase()).toBe(MANAGED_SIGNER.address);
  });

  test("moves the chain's own currency by value, the fee being the gas itself", async () => {
    const chain = fakeChain();
    const result = await provider({
      transport: chain.transport,
      fetchFn: chain.fetchFn,
    }).propose(wallet(), {
      kind: "withdraw",
      amount: { amount: 10n ** 15n, asset: "ETH" },
      to: DESTINATION,
    });

    const { legs } = legsOf(chain.broadcast);
    const [net, fee] = legs as [Leg, Leg];
    expect(result.networkFee.asset).toBe("ETH");
    expect(net.to.toLowerCase()).toBe(DESTINATION);
    expect(net.data).toBe("0x");
    expect(net.value).toBe(10n ** 15n - result.networkFee.amount);
    expect(fee.to.toLowerCase()).toBe(DEPLOYER.toLowerCase());
    expect(fee.value).toBe(result.networkFee.amount);
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
