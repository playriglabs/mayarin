/**
 * Presets are config bundles, not build targets (#14).
 *
 * A preset names the integration shape and carries the defaults the SDK
 * modules apply when the caller states nothing. The transport ignores them;
 * only module-level behaviour differs.
 */

export type PresetName = "merchant";

export interface Preset {
  readonly name: PresetName;
  /** Payment links created with no amount let the payer type one. */
  readonly openAmountLinks: false;
  /** The commerce surface the integration leans on. */
  readonly checkout: "catalog";
}

export const PRESETS: Readonly<Record<PresetName, Preset>> = {
  // A merchant back office manages the catalog and queries payments.
  merchant: { name: "merchant", openAmountLinks: false, checkout: "catalog" },
} as const;
