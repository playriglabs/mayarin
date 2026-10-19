/**
 * How much the operator key holds (SEC-06).
 *
 * The operator is a hot wallet by design: it pays gas and fronts the working
 * float for sweeps and swaps. What it must not do is accumulate, because whatever
 * it holds is what a compromise takes. So each (chain, asset) has a ceiling, and
 * native currency has a floor too: an operator that cannot pay gas stalls every
 * sweep, which looks like an outage from the payer's side.
 *
 * It reports, one finding per breach each pass. Moving the excess to the treasury
 * Safe is a person's decision, and a service that sweeps by itself needs a
 * signing policy wide enough to be worth attacking.
 */

import type { AssetCode } from "./asset.ts";
import { ConfigurationError } from "./errors.ts";
import { fromDecimalString } from "./money.ts";

export interface FloatLimit {
  /** Whole units, as a decimal string. */
  readonly min?: string;
  readonly max?: string;
}

/** Chain to asset to limit. */
export type FloatLimits = Readonly<Record<string, Readonly<Record<string, FloatLimit>>>>;

export interface FloatReader {
  /** The operator's balance of `asset` on `chain`, in the asset's minor units. */
  balance(chain: string, asset: AssetCode): Promise<bigint>;
}

export interface FloatFinding {
  readonly type: "operator-float";
  readonly finding: "above-max" | "below-min";
  readonly chain: string;
  readonly asset: string;
  readonly balance: string;
  readonly limit: string;
}

interface Bound {
  readonly chain: string;
  readonly asset: AssetCode;
  readonly min?: bigint;
  readonly max?: bigint;
}

export class OperatorFloatMonitor {
  readonly #reader: FloatReader;
  readonly #bounds: readonly Bound[];

  /** Throws on an unknown asset, a malformed amount, or a min above its max. */
  constructor(reader: FloatReader, limits: FloatLimits) {
    this.#reader = reader;
    this.#bounds = Object.entries(limits).flatMap(([chain, assets]) =>
      Object.entries(assets).map(([asset, limit]) => parseBound(chain, asset as AssetCode, limit)),
    );
  }

  /** One pass. A chain the reader cannot read is skipped and reported by the caller's logs. */
  async run(): Promise<readonly FloatFinding[]> {
    const findings: FloatFinding[] = [];
    for (const bound of this.#bounds) {
      const balance = await this.#reader.balance(bound.chain, bound.asset);
      if (bound.max !== undefined && balance > bound.max) {
        findings.push(finding("above-max", bound, balance, bound.max));
      }
      if (bound.min !== undefined && balance < bound.min) {
        findings.push(finding("below-min", bound, balance, bound.min));
      }
    }
    return findings;
  }
}

function parseBound(chain: string, asset: AssetCode, limit: FloatLimit): Bound {
  const read = (value: string | undefined): bigint | undefined => {
    if (value === undefined) return undefined;
    try {
      return fromDecimalString(value, asset).amount;
    } catch (error) {
      throw new ConfigurationError("An operator float limit is not an amount of its asset", {
        chain,
        asset,
        value,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const min = read(limit.min);
  const max = read(limit.max);
  if (min === undefined && max === undefined) {
    throw new ConfigurationError("An operator float limit needs a min or a max", { chain, asset });
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new ConfigurationError("An operator float minimum is above its maximum", {
      chain,
      asset,
    });
  }
  return {
    chain,
    asset,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

function finding(
  kind: FloatFinding["finding"],
  bound: Bound,
  balance: bigint,
  limit: bigint,
): FloatFinding {
  return {
    type: "operator-float",
    finding: kind,
    chain: bound.chain,
    asset: bound.asset,
    balance: balance.toString(),
    limit: limit.toString(),
  };
}
