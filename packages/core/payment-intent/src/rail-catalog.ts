/**
 * Which rails a payer can actually be paid on (#244).
 *
 * A rail is one `(chain, asset)` pair. Before this existed the chain was
 * whichever key came first in `CHAIN_ASSETS` and the asset list was a union
 * across every configured chain — invisible with one chain, wrong with two: a
 * payer on Arc was offered ETH, which does not exist there.
 *
 * The catalog is a **read model**, derived rather than configured. Nothing here
 * decides what a deployment supports; it reports the pairs where every
 * precondition already holds, and names the reason for each pair it drops. The
 * reasons are the point: a merchant who cannot be paid on a chain has to learn
 * it in their own dashboard, not from a payment that refuses to lock.
 *
 * Pure, and effects arrive as ports, so the whole rule is testable without a
 * chain, a database or a price source.
 *
 * ## The cross-chain contract hazard
 *
 * `merchants.settlement_address` is one value that wins on **every** chain. A
 * merchant who set it to a Safe deployed on Base is otherwise paid to that same
 * address on Arc, where it has no code — the payment settles and the money is
 * at an address nobody can spend from. So a configured address with code on one
 * configured chain and none on the paying chain is refused there. An address
 * with code nowhere is an EOA, and the same key controls it on every chain.
 */

import type { ChainId, ContractCodeSource } from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";
import { acceptedPayerAssets, type MerchantAssetPolicySource } from "./merchant-policy.ts";

/**
 * One `(chain, asset)` pair a payer may choose.
 *
 * Named for the offer rather than the choice: `PaymentRail` in `types.ts` is
 * the rail an intent was minted on, and the two must not be confused. This one
 * is a row in a menu; that one is a decision already made.
 */
export interface OfferedRail {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  /** Absent for a chain's own currency, which has no contract. */
  readonly contract?: string;
  /**
   * Where the merchant is paid on this chain, resolved per chain.
   *
   * Absent on a deployment that settles off-chain, where there is no on-chain
   * destination to resolve and none is a precondition for offering the rail.
   */
  readonly payTo?: string;
}

/**
 * What this deployment can receive on one chain.
 *
 * Assembled by the composition root from configuration and from what is
 * actually watching each chain — a chain nothing watches must not appear here,
 * because a payer sent to it is a payer whose funds nobody notices.
 */
export interface ChainReceipt {
  readonly chain: ChainId;
  /**
   * The chain's own currency, when it has one that is watched.
   *
   * Absent on Arc on purpose: Arc's native currency **is** USDC over one
   * balance, so naming it here as well as in `tokens` would offer two ways to
   * pay that are one. `railsFor` dedupes by asset regardless — the token entry
   * wins, because it carries the contract the watcher reads.
   */
  readonly nativeAsset?: AssetCode;
  /** Token asset to its contract address on this chain. */
  readonly tokens: Readonly<Partial<Record<AssetCode, string>>>;
}

/**
 * Where a merchant is paid on one chain, or `undefined` when nowhere.
 *
 * A port rather than a direct dependency on `@mayarin/wallet`: the rule below
 * has to hold whatever resolves the destination, and `core` packages do not
 * depend on each other sideways. `SettlementAddressResolver.effective` already
 * has this shape.
 */
export interface SettlementDestinationSource {
  destinationFor(
    merchantId: string,
    chain: ChainId,
    configured: string | undefined,
  ): Promise<string | undefined>;
}

/** Whether this deployment can price a rail's asset into what the merchant settles in. */
export interface RailPricingSource {
  canPrice(rail: {
    readonly chain: ChainId;
    readonly asset: AssetCode;
    readonly settlementAsset: AssetCode;
  }): Promise<boolean>;
}

/** Why a chain or a pair is not offered. Written for a merchant to read. */
export type RailExclusion =
  | { readonly kind: "no-settlement-destination"; readonly chain: ChainId; readonly reason: string }
  | {
      readonly kind: "settlement-address-has-no-code";
      readonly chain: ChainId;
      readonly reason: string;
    }
  | {
      readonly kind: "not-priceable";
      readonly chain: ChainId;
      readonly asset: AssetCode;
      readonly reason: string;
    }
  | {
      readonly kind: "not-accepted";
      readonly chain: ChainId;
      readonly asset: AssetCode;
      readonly reason: string;
    };

/** Every rail this merchant can be paid on, and every one they cannot, with why. */
export interface RailReport {
  readonly rails: readonly OfferedRail[];
  readonly unavailable: readonly RailExclusion[];
  /** What the merchant is paid in, which every rail is priced into. */
  readonly settlementAsset: AssetCode;
}

export interface RailCatalogOptions {
  /** Chains this deployment watches, and what it can see arrive on each. */
  readonly receipts: readonly ChainReceipt[];
  readonly merchantPolicies: MerchantAssetPolicySource;
  /**
   * Where the merchant is paid on each chain.
   *
   * Absent on a deployment that settles off-chain through an adapter: there is
   * no on-chain destination to have, so requiring one would offer no rails at
   * all. Present on every deployment that moves value on a chain, where a
   * merchant with nowhere to be paid must not be offered that chain.
   */
  readonly settlement?: SettlementDestinationSource;
  readonly pricing: RailPricingSource;
  /** What a merchant who has no policy of their own is paid in. */
  readonly defaultSettlementAsset: AssetCode;
  /**
   * Reads deployed code. Absent on a deployment with no chain access, and the
   * contract-address check is then skipped rather than failing every rail —
   * such a deployment settles off-chain, where the hazard does not arise.
   */
  readonly code?: ContractCodeSource;
}

export interface RailCatalog {
  railsFor(merchantId: string): Promise<readonly OfferedRail[]>;
  /** The same derivation, keeping the rails it dropped and why. */
  describe(merchantId: string): Promise<RailReport>;
}

export class DerivedRailCatalog implements RailCatalog {
  readonly #receipts: readonly ChainReceipt[];
  readonly #policies: MerchantAssetPolicySource;
  readonly #settlement: SettlementDestinationSource | undefined;
  readonly #pricing: RailPricingSource;
  readonly #defaultSettlementAsset: AssetCode;
  readonly #code: ContractCodeSource | undefined;

  constructor(options: RailCatalogOptions) {
    this.#receipts = options.receipts;
    this.#policies = options.merchantPolicies;
    this.#settlement = options.settlement;
    this.#pricing = options.pricing;
    this.#defaultSettlementAsset = options.defaultSettlementAsset;
    this.#code = options.code;
  }

  async railsFor(merchantId: string): Promise<readonly OfferedRail[]> {
    return (await this.describe(merchantId)).rails;
  }

  async describe(merchantId: string): Promise<RailReport> {
    const policy = await this.#policies.policyFor(merchantId);
    const settlementAsset = policy?.settlementAsset ?? this.#defaultSettlementAsset;
    const configured = policy?.settlementAddress;

    const rails: OfferedRail[] = [];
    const unavailable: RailExclusion[] = [];

    // Read once for the whole report: the contract check asks about the same
    // address on every chain, and asking per rail would be one RPC round trip
    // per asset for an answer that cannot differ between them.
    const codeChains = await this.#chainsWithCode(configured);

    for (const receipt of this.#receipts) {
      const chain = receipt.chain;
      const payTo = await this.#settlement?.destinationFor(merchantId, chain, configured);
      if (this.#settlement !== undefined && payTo === undefined) {
        unavailable.push({
          kind: "no-settlement-destination",
          chain,
          reason: `No settlement address on ${chain}. Set one, or provision a managed wallet on ${chain}.`,
        });
        continue;
      }

      if (codeChains !== undefined && codeChains.size > 0 && !codeChains.has(chain)) {
        unavailable.push({
          kind: "settlement-address-has-no-code",
          chain,
          reason: `Your settlement address is a contract on ${[...codeChains].join(", ")} and has no code on ${chain}. A contract does not exist on a chain it was not deployed to, so paying it there would strand the funds.`,
        });
        continue;
      }

      // Read per chain, because a merchant who accepts ETH is not saying they
      // accept it on a chain that has none.
      const accepted = policy === undefined ? [] : acceptedPayerAssets(policy, chain);

      for (const [asset, contract] of assetsOn(receipt)) {
        if (accepted.length > 0 && !accepted.includes(asset)) {
          unavailable.push({
            kind: "not-accepted",
            chain,
            asset,
            reason: `${asset} is not in the assets you accept on ${chain}.`,
          });
          continue;
        }

        if (!(await this.#pricing.canPrice({ chain, asset, settlementAsset }))) {
          unavailable.push({
            kind: "not-priceable",
            chain,
            asset,
            reason: `${asset} on ${chain} cannot be priced into ${settlementAsset} right now.`,
          });
          continue;
        }

        rails.push({
          chain,
          asset,
          ...(contract === undefined ? {} : { contract }),
          ...(payTo === undefined ? {} : { payTo }),
        });
      }
    }

    return { rails, unavailable, settlementAsset };
  }

  /**
   * The configured chains the merchant's own settlement address has code on.
   *
   * `undefined` means the question was not asked — no configured address, or no
   * way to read code. An empty set means it was asked and the answer was
   * nowhere, which is an EOA and passes everywhere.
   */
  async #chainsWithCode(configured: string | undefined): Promise<ReadonlySet<ChainId> | undefined> {
    const code = this.#code;
    if (configured === undefined || code === undefined || this.#settlement === undefined) {
      return undefined;
    }

    const found = new Set<ChainId>();
    for (const receipt of this.#receipts) {
      if (await code.hasCode(receipt.chain, configured)) found.add(receipt.chain);
    }
    return found;
  }
}

/**
 * The assets one chain can receive, deduped, token entry first.
 *
 * The dedupe is Arc's duality: its own currency is USDC — 18 decimals natively,
 * 6 as an ERC-20, over a single balance — so a chain naming the same asset both
 * ways must still emit one rail. The token entry wins because it carries the
 * contract address the watcher and the settlement path both read.
 */
function assetsOn(receipt: ChainReceipt): readonly (readonly [AssetCode, string | undefined])[] {
  const entries = new Map<AssetCode, string | undefined>();
  for (const [asset, contract] of Object.entries(receipt.tokens)) {
    if (contract !== undefined) entries.set(asset as AssetCode, contract);
  }
  if (receipt.nativeAsset !== undefined && !entries.has(receipt.nativeAsset)) {
    entries.set(receipt.nativeAsset, undefined);
  }
  return [...entries];
}
