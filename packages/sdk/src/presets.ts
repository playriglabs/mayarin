/**
 * Presets are config bundles, not build targets (#14).
 *
 * A preset names the integration shape and carries the defaults the SDK
 * modules apply when the caller states nothing. The transport ignores them;
 * only module-level behaviour differs.
 */

export type PresetName = "pos" | "merchant";

export interface Preset {
  readonly name: PresetName;
  /** Payment links created with no amount let the payer type one. */
  readonly openAmountLinks: boolean;
  /** The checkout flow the integration leans on. */
  readonly checkout: "cart" | "catalog";
}

export const PRESETS: Readonly<Record<PresetName, Preset>> = {
  // A counter POS mints a link per sale and rings up ad-hoc carts.
  pos: { name: "pos", openAmountLinks: true, checkout: "cart" },
  // A merchant back office manages the catalog and queries payments.
  merchant: { name: "merchant", openAmountLinks: false, checkout: "catalog" },
} as const;
