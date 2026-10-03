/**
 * Wire shape of a payment's escrow (#304). Bigints travel as decimal strings.
 */

import type { ChainId } from "@mayarin/chain";
import { z } from "zod";

/** A payer's message in their dispute, signed by the wallet they paid with (#313). */
export const disputeMessageBodySchema = z.object({
  body: z.string(),
  signedAt: z.string(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be hex"),
});

type Hex = `0x${string}`;

export interface DisputeMessageDto {
  readonly id: string;
  readonly author: "payer" | "merchant" | "arbiter";
  readonly body: string;
  readonly createdAt: string;
}

export interface EscrowDto {
  readonly chain: ChainId;
  readonly chainId: string;
  readonly factory: string;
  readonly address: string;
  readonly token: string;
  readonly terms: {
    readonly intentId: Hex;
    readonly payer: string;
    readonly payee: string;
    readonly arbiter: string;
    readonly releaseAfter: string;
    readonly resolveBy: string;
  };
  readonly outcome: "held" | "released" | "refunded" | "split";
  readonly disputed: boolean;
  readonly balance: string;
  readonly bond: string | null;
  readonly calls: {
    readonly approveBond: Hex | null;
    readonly release: Hex;
    readonly refund: Hex;
    readonly dispute: Hex;
  };
  readonly payerStanding: "good" | "flagged";
  readonly dispute: {
    readonly id: string;
    readonly reference: string;
    readonly status: "open" | "released" | "refunded" | "split";
    readonly openedAt: string;
    readonly decidedAt: string | null;
    readonly messages: readonly DisputeMessageDto[];
  } | null;
}
