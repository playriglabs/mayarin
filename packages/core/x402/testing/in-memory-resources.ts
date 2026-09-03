/**
 * In-memory `X402ResourceRepository`, and the fixtures a resource test needs.
 *
 * The repository enforces the one invariant the Postgres adapter will: a
 * resource id is unique, and saving the same id twice replaces rather than
 * duplicates. A test that passes against this is not passing for a reason the
 * database will later withdraw.
 */

import type { AssetCode, Money } from "@mayarin/shared";
import { money } from "@mayarin/shared";
import type {
  AcceptedAsset,
  PricedAsset,
  X402Resource,
  X402ResourceRepository,
} from "../src/index.ts";

export class InMemoryResourceRepository implements X402ResourceRepository {
  readonly #byId = new Map<string, X402Resource>();

  async findById(id: string): Promise<X402Resource | undefined> {
    return this.#byId.get(id);
  }

  async listByMerchant(merchantId: string): Promise<readonly X402Resource[]> {
    return [...this.#byId.values()].filter((resource) => resource.merchantId === merchantId);
  }

  async save(resource: X402Resource): Promise<void> {
    this.#byId.set(resource.id, resource);
  }
}

/** USDC on Base Sepolia, as the token actually reports itself. */
export const USDC_BASE_SEPOLIA: AcceptedAsset = {
  chain: "base-sepolia",
  asset: "USDC",
  contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  domain: { name: "USDC", version: "2" },
  transferMethod: "eip3009",
};

/**
 * USDC on Arc, at the address measured on 3 September 2026. Not a precompile
 * despite the shape of it — Circle's FiatTokenV2 behind an EIP-1967 proxy, with
 * EIP-3009 present and the same `{USDC, 2}` domain.
 */
export const USDC_ARC_TESTNET: AcceptedAsset = {
  chain: "arc-testnet",
  asset: "USDC",
  contract: "0x3600000000000000000000000000000000000000",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  domain: { name: "USDC", version: "2" },
  transferMethod: "eip3009",
};

export function exampleResource(overrides: Partial<X402Resource> = {}): X402Resource {
  return {
    id: "res_fx_quote",
    merchantId: "mer_example",
    url: "https://api.example.com/x402/fx/quote",
    description: "One oracle-guarded FX quote",
    mimeType: "application/json",
    // Priced in the merchant's own currency, which is not what anyone pays in.
    price: money(1_500n, "IDR"),
    accepts: [USDC_BASE_SEPOLIA],
    maxTimeoutSeconds: 60,
    ...overrides,
  };
}

/**
 * A resource with the optional `ResourceInfo` fields genuinely absent rather
 * than set to `undefined` — which `exactOptionalPropertyTypes` distinguishes,
 * and which is what a merchant who filled in only a URL actually stores.
 */
export function bareResource(): X402Resource {
  const { description: _description, mimeType: _mimeType, ...rest } = exampleResource();
  return rest;
}

/** A price quoted into an accepted asset, valid for `seconds` from `now`. */
export function priced(
  accept: AcceptedAsset,
  amount: Money,
  now: Date,
  seconds: number,
): PricedAsset {
  return { accept, amount, expiresAt: new Date(now.getTime() + seconds * 1000) };
}

/** Atomic units of an asset, for a test that does not care about decimals. */
export function atomic(units: bigint, asset: AssetCode): Money {
  return money(units, asset);
}
