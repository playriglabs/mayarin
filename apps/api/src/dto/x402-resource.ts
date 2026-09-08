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
import type { X402Resource } from "@mayarin/x402";
import { z } from "zod";
import { toMoneyDto } from "./money.ts";

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

export function toX402ResourceDto(resource: X402Resource): Record<string, unknown> {
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
