/** x402 resource DTOs, mirroring `/x402-resources` on the dashboard API (#208). */

import type { MoneyDto } from "@/types/payment";

/** A rail the merchant could offer: chosen by chain, never by address. */
export interface X402RailOption {
  readonly chain: string;
  readonly asset: string;
  readonly contract: string;
  /** Merchant's own verified address, or the operator on a cross-asset rail. */
  readonly payTo: string;
  readonly kind: "same-asset" | "cross-asset";
}

export interface X402Accept extends Omit<X402RailOption, "kind"> {
  /** What the token implements, read off the contract at registration. */
  readonly transferMethod: string;
  readonly domain: { readonly name: string; readonly version: string };
}

export interface X402ResourceDto {
  readonly id: string;
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly price: MoneyDto;
  readonly maxTimeoutSeconds: number;
  readonly accepts: readonly X402Accept[];
}

export interface X402ResourceListResponse {
  readonly resources: readonly X402ResourceDto[];
}

export interface X402RailsResponse {
  readonly rails: readonly X402RailOption[];
}

export interface CreateX402ResourceRequest {
  readonly id: string;
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly price: { readonly amount: string; readonly asset: string };
  readonly maxTimeoutSeconds: number;
  readonly rails: readonly { readonly chain: string; readonly asset: string }[];
}

export interface X402ResourceResponse {
  readonly resource: X402ResourceDto;
}
