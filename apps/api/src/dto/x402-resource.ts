/**
 * The x402 resource wire shape, shared by the admin and merchant surfaces.
 *
 * One schema for both, because they register the same thing and a resource
 * accepted by one route and refused by the other would be a difference nobody
 * decided. The body names tokens, never their EIP-712 domain or transfer
 * method: those are read off the contracts at registration, so a resource
 * cannot advertise terms no payer could sign.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import { assetCodeSchema } from "@mayarin/shared";
import type { AssetTransferMethod, X402Resource } from "@mayarin/x402";
import { z } from "zod";
import { type MoneyDto, toMoneyDto } from "./money.ts";

export const x402ResourceSchema = z
  .object({
    id: z.string().min(1),
    merchantId: z.string().min(1),
    url: z.string().url(),
    description: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    price: z.object({ amount: z.string().min(1), asset: assetCodeSchema }),
    accepts: z
      .array(
        z.object({
          chain: z.enum(CHAIN_IDS),
          asset: assetCodeSchema,
          contract: z.string().min(1),
          payTo: z.string().min(1),
        }),
      )
      .min(1),
    maxTimeoutSeconds: z.number().int().positive(),
    /** Whether it appears in the public cross-merchant index (#273). */
    listed: z.boolean().optional(),
  })
  .strict();

/** The merchant surface takes its merchant from the key, not from the body. */
export const merchantX402ResourceSchema = x402ResourceSchema.omit({ merchantId: true });

/** The body both registration surfaces parse — one definition for API and SDK. */
export type X402ResourceBody = z.infer<typeof merchantX402ResourceSchema>;

/** One accepted payer rail, as the API answers it: the token's own terms echoed back. */
export interface X402AcceptedAssetDto {
  readonly chain: string;
  readonly asset: string;
  readonly contract: string;
  readonly payTo: string;
  /**
   * Read off the contract at registration, never entered — the only place
   * these two values ever come from is the token itself.
   */
  readonly transferMethod: AssetTransferMethod;
  /** The token's EIP-712 name and version, as the token reports them. */
  readonly domain: { readonly name: string; readonly version: string };
}

/** A registered x402 resource, as the merchant and admin surfaces answer it. */
export interface X402ResourceDto {
  readonly id: string;
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly price: MoneyDto;
  readonly maxTimeoutSeconds: number;
  /** Whether it appears in the public cross-merchant index (#273). */
  readonly listed: boolean;
  readonly accepts: readonly X402AcceptedAssetDto[];
}

export function toX402ResourceDto(resource: X402Resource): X402ResourceDto {
  return {
    id: resource.id,
    url: resource.url,
    ...(resource.description === undefined ? {} : { description: resource.description }),
    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
    price: toMoneyDto(resource.price),
    maxTimeoutSeconds: resource.maxTimeoutSeconds,
    /** Whether it appears in the public cross-merchant index (#273). */
    listed: resource.listed,
    accepts: resource.accepts.map((accept) => ({
      chain: accept.chain,
      asset: accept.asset,
      contract: accept.contract,
      payTo: accept.payTo,
      // Echoed so the caller can see what the token actually said, which is the
      // only place these two values ever come from.
      transferMethod: accept.transferMethod,
      domain: accept.domain,
    })),
  };
}
