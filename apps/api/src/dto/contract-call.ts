/**
 * Wire shape of the contract-path submit payload (#61).
 *
 * Every bigint travels as a decimal string — the wire carries no number that
 * could round. `transaction` is the ready `payEth` call for a native payer;
 * an ERC-20 payer assembles `payERC20` client-side, because only their
 * wallet can sign the Permit2 authorisation.
 */

import type { ChainId } from "@mayarin/chain";
import type { SerializedMoney } from "@mayarin/shared";

type Hex = `0x${string}`;

export interface EvmContractCallDto {
  readonly kind: "evm";
  readonly chain: ChainId;
  readonly chainId: string;
  readonly paymentRouter: string;
  readonly order: {
    readonly intentId: Hex;
    readonly settlementToken: Hex;
    readonly minOut: string;
    readonly fee: string;
    readonly merchantSafe: Hex;
    readonly refundTo: Hex;
    readonly deadline: string;
  };
  readonly signature: Hex;
  readonly route: {
    readonly router: string;
    readonly callData: Hex;
    readonly expectedIn: SerializedMoney;
    readonly expiresAt?: string;
  } | null;
  readonly transaction: { readonly to: Hex; readonly data: Hex; readonly value: string } | null;
  readonly payerEstimate: SerializedMoney;
  readonly expiresAt: string;
}

export interface SolanaContractCallDto {
  readonly kind: "solana";
  readonly chain: ChainId;
  readonly paymentRouter: string;
  readonly order: {
    readonly intentId: string;
    readonly settlementToken: string;
    readonly minOut: string;
    readonly fee: string;
    readonly merchantSafe: string;
    readonly refundTo: string;
    readonly deadline: string;
  };
  /** Base64 Ed25519 signature over the domain-separated order. */
  readonly signature: string;
  /** Base64 transaction for the payer wallet to sign and submit. */
  readonly transaction: string;
  /** Base64 account-preparation transactions, submitted before payment. */
  readonly preparationTransactions: readonly string[];
  readonly payerEstimate: SerializedMoney;
  readonly expiresAt: string;
}

export type ContractCallDto = EvmContractCallDto | SolanaContractCallDto;
