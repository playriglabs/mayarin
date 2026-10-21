/**
 * The merchant analytics read: the figures the dashboard's Analytics page
 * draws, for your own reporting.
 *
 * Needs a key with `payments:read`. One call returns every metric for a range,
 * as a total, the change against the range before, and a point per bucket,
 * plus what payers sent and how reliably each network and asset finishes.
 */

import type { AnalyticsDto, AnalyticsInterval, AnalyticsMetricKey } from "@mayarin/api/dto";
import type { RequestOptions, Transport } from "./transport.ts";

export interface GetAnalyticsOptions extends RequestOptions {
  /** First UTC day, `2026-10-01`, inclusive. Default: 29 days before `to`. */
  readonly from?: string;
  /** Last UTC day, inclusive. Default: today. */
  readonly to?: string;
  /** Bucket size of each metric's points. Default `day`. */
  readonly interval?: AnalyticsInterval;
  /** Only payments paid on this network, e.g. `base-sepolia`. */
  readonly chain?: string;
  /** Only payments the payer sent in this asset, e.g. `USDC`. */
  readonly asset?: string;
  /** Only these metrics. Default: all of them. */
  readonly metrics?: readonly AnalyticsMetricKey[];
}

export interface AnalyticsModule {
  /** `GET /analytics` — metrics, payer mix and per-network performance for a range of up to 366 days. */
  readonly get: (options?: GetAnalyticsOptions) => Promise<AnalyticsDto>;
}

export function createAnalyticsModule(transport: Transport): AnalyticsModule {
  return {
    get: ({ from, to, interval, chain, asset, metrics, ...options } = {}) =>
      transport.get<AnalyticsDto>("/analytics", {
        ...options,
        query: {
          ...(options.query ?? {}),
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
          ...(interval === undefined ? {} : { interval }),
          ...(chain === undefined ? {} : { chain }),
          ...(asset === undefined ? {} : { asset }),
          ...(metrics === undefined ? {} : { metrics: metrics.join(",") }),
        },
      }),
  };
}
