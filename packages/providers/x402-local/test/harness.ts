/**
 * A local EIP-3009 payer and a chain that answers whatever a test says.
 *
 * The signature is real. `privateKeyToAccount` signs the same typed data the
 * reader verifies, offline, so the signature check is exercised rather than
 * stubbed — a test that passes here would pass against the token. Everything
 * that needs a node (balance, nonce state, simulation, receipts) is stubbed,
 * because those are the parts a unit test cannot honestly have.
 */

import { caip2Of, EVM_CHAIN_IDS } from "@mayarin/chain";
import type { Clock } from "@mayarin/shared";
import { FixedClock } from "@mayarin/shared";
import type { Authorization, PaymentPayload, PaymentRequirements } from "@mayarin/x402";
import { TRANSFER_WITH_AUTHORIZATION_TYPES, X402_VERSION } from "@mayarin/x402";
import {
  type Address,
  type Hex,
  type PublicClient,
  verifyTypedData,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LocalX402Facilitator } from "../src/facilitator.ts";
import { EvmX402Reader } from "../src/reader.ts";

export const CHAIN = "base-sepolia" as const;
export const NETWORK = caip2Of(CHAIN);
export const NOW = new Date(1_740_672_120 * 1000);

export const PAYER = privateKeyToAccount(`0x${"11".repeat(32)}`);
export const OPERATOR = privateKeyToAccount(`0x${"22".repeat(32)}`);

export const ASSET: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const MERCHANT: Address = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

export const REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  amount: "10000",
  asset: ASSET,
  payTo: MERCHANT,
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};

export const AUTHORIZATION: Authorization = {
  from: PAYER.address,
  to: MERCHANT,
  value: "10000",
  validAfter: "1740672089",
  validBefore: "1740672154",
  nonce: `0x${"ab".repeat(32)}`,
};

/** A payload whose signature genuinely recovers to the payer. */
export async function signedPayment(
  overrides: Partial<Authorization> = {},
  requirements: PaymentRequirements = REQUIREMENTS,
): Promise<PaymentPayload> {
  const authorization = { ...AUTHORIZATION, ...overrides };
  const signature = await PAYER.signTypedData({
    domain: {
      name: "USDC",
      version: "2",
      chainId: Number(EVM_CHAIN_IDS[CHAIN]),
      verifyingContract: requirements.asset as Address,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as Address,
      to: authorization.to as Address,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as Hex,
    },
  });

  return {
    x402Version: X402_VERSION,
    accepted: requirements,
    payload: { signature, authorization },
  };
}

/**
 * The same authorization, signed by a key that is not the payer's.
 *
 * Every static check passes on this payload — the amount, the recipient, the
 * window and the signature length are all correct. Only recovery separates it
 * from a real payment.
 */
export async function forgedPayment(
  overrides: Partial<Authorization> = {},
): Promise<PaymentPayload> {
  const forger = privateKeyToAccount(`0x${"33".repeat(32)}`);
  const authorization = { ...AUTHORIZATION, ...overrides };
  const signature = await forger.signTypedData({
    domain: {
      name: "USDC",
      version: "2",
      chainId: Number(EVM_CHAIN_IDS[CHAIN]),
      verifyingContract: ASSET,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as Address,
      to: authorization.to as Address,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as Hex,
    },
  });

  return {
    x402Version: X402_VERSION,
    accepted: REQUIREMENTS,
    payload: { signature, authorization },
  };
}

export interface ChainState {
  balance: bigint;
  authorizationUsed: boolean;
  simulationFails: boolean;
  /** Receipts by transaction hash. */
  receipts: Map<string, { status: "success" | "reverted"; logs: readonly unknown[] }>;
  /** Every broadcast, in the order the node saw them. */
  broadcasts: string[];
  /** Milliseconds each broadcast takes to return, so a race can be provoked. */
  broadcastDelayMs: number;
  /** A payer that is a contract account: valid to the chain, forged to `ecrecover`. */
  contractSignature: boolean;
  nextHash: () => Hex;
}

export function chainState(overrides: Partial<ChainState> = {}): ChainState {
  let counter = 0;
  return {
    balance: 1_000_000n,
    authorizationUsed: false,
    simulationFails: false,
    receipts: new Map(),
    broadcasts: [],
    broadcastDelayMs: 0,
    contractSignature: false,
    nextHash: () => `0x${(++counter).toString(16).padStart(64, "0")}` as Hex,
    ...overrides,
  };
}

export function transferLog(
  from: Address,
  to: Address,
  value: bigint,
  asset: Address = ASSET,
): unknown {
  const pad = (address: Address) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
  return {
    address: asset,
    // keccak256("Transfer(address,address,uint256)")
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      pad(from),
      pad(to),
    ],
    data: `0x${value.toString(16).padStart(64, "0")}`,
  };
}

export function publicClientFor(state: ChainState): PublicClient {
  return {
    // The chain's answer about a signature, which for an EOA is the recovery
    // viem would have done offline anyway. `state.contractSignature` is the
    // other kind of payer: a contract account whose signature validates through
    // EIP-1271 and recovers to nobody.
    async verifyTypedData(parameters: Parameters<typeof verifyTypedData>[0]) {
      return state.contractSignature || (await verifyTypedData(parameters));
    },
    async readContract({ functionName }: { functionName: string }) {
      if (functionName === "balanceOf") return state.balance;
      if (functionName === "authorizationState") return state.authorizationUsed;
      throw new Error(`unexpected read ${functionName}`);
    },
    async simulateContract() {
      if (state.simulationFails) throw new Error("execution reverted");
      return { request: {} };
    },
    async getTransactionReceipt({ hash }: { hash: string }) {
      const receipt = state.receipts.get(hash);
      if (receipt === undefined) throw new Error("transaction not found");
      return receipt;
    },
    async waitForTransactionReceipt({ hash }: { hash: string }) {
      const receipt = state.receipts.get(hash);
      if (receipt === undefined) throw new Error("transaction not found");
      return receipt;
    },
  } as unknown as PublicClient;
}

export function walletClientFor(state: ChainState): WalletClient {
  return {
    async writeContract() {
      const hash = state.nextHash();
      if (state.broadcastDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.broadcastDelayMs));
      }
      state.broadcasts.push(hash);
      return hash;
    },
  } as unknown as WalletClient;
}

export function facilitatorFor(
  state: ChainState,
  clock: Clock = new FixedClock(NOW),
): { facilitator: LocalX402Facilitator; reader: EvmX402Reader } {
  const publicClient = publicClientFor(state);
  const reader = new EvmX402Reader({ chain: CHAIN, publicClient });
  const facilitator = new LocalX402Facilitator({
    chain: CHAIN,
    reader,
    publicClient,
    walletClient: walletClientFor(state),
    account: OPERATOR,
    clock,
  });
  return { facilitator, reader };
}
