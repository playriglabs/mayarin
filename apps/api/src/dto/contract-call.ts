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

export interface ContractCallDto {
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
