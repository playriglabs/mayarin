/**
 * The merchant surface for x402 resources (#269): register an endpoint, see
 * what is registered, withdraw it, and opt in or out of the public discovery
 * index.
 *
 * Registration is the only place a secret key is needed. Once a resource is
 * registered, the request-time surface (`/x402/*`) is public and keyless —
 * the payer pays, Mayarin settles, nobody's credentials ride on a payment.
 *
 * The registered `url` must be the exact URL an agent will call: scheme, host
 * and path all count, because a resource is identified by it.
 */

import type { X402ResourceBody, X402ResourceDto } from "@mayarin/api/dto";
import type { RequestOptions, Transport } from "./transport.ts";

export interface X402ResourcesModule {
  /** `POST /x402/resources` — register or re-register. Omitted `listed` means unchanged (#273). */
  readonly register: (body: X402ResourceBody, options?: RequestOptions) => Promise<X402ResourceDto>;
  /** `GET /x402/resources` — this merchant's own resources. */
  readonly list: (options?: RequestOptions) => Promise<readonly X402ResourceDto[]>;
  /** `DELETE /x402/resources/:id` — stop offering the `402`. Nothing paid is undone. */
  readonly remove: (id: string, options?: RequestOptions) => Promise<void>;
  /** `POST /x402/resources/:id/list` — appear in the public cross-merchant index. */
  readonly listInIndex: (id: string, options?: RequestOptions) => Promise<X402ResourceDto>;
  /** `POST /x402/resources/:id/unlist` — stop appearing in the index, stay payable. */
  readonly unlistFromIndex: (id: string, options?: RequestOptions) => Promise<X402ResourceDto>;
}

function resourcePath(id: string): string {
  return `/x402/resources/${encodeURIComponent(id)}`;
}

export function createX402ResourcesModule(transport: Transport): X402ResourcesModule {
  return {
    register: async (body, options) =>
      (await transport.post<{ resource: X402ResourceDto }>("/x402/resources", body, options))
        .resource,
    list: async (options) =>
      (await transport.get<{ resources: readonly X402ResourceDto[] }>("/x402/resources", options))
        .resources,
    remove: (id, options) => transport.delete<void>(resourcePath(id), options),
    listInIndex: async (id, options) =>
      (
        await transport.post<{ resource: X402ResourceDto }>(
          `${resourcePath(id)}/list`,
          undefined,
          options,
        )
      ).resource,
    unlistFromIndex: async (id, options) =>
      (
        await transport.post<{ resource: X402ResourceDto }>(
          `${resourcePath(id)}/unlist`,
          undefined,
          options,
        )
      ).resource,
  };
}
