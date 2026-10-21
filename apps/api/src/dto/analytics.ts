/**
 * Wire shape of the merchant analytics read.
 *
 * One request returns every figure the dashboard's Analytics page draws:
 * metrics as a total plus a point per bucket, the mix of what payers sent and
 * where, and how reliably each network and asset finishes. Money is USD cents;
 * an asset with no USD rate is left out of a money figure rather than guessed.
 */

import { z } from "zod";

export const ANALYTICS_INTERVALS = ["day", "week", "month"] as const;
export type AnalyticsInterval = (typeof ANALYTICS_INTERVALS)[number];

export const ANALYTICS_METRICS = [
  "revenue",
  "net_revenue",
  "average_order_value",
  "fees",
  "orders",
  "checkouts",
  "conversion_rate",
  "failed_checkouts",
  "time_to_pay",
  "time_to_pay_p90",
  "success_rate",
  "settled_volume",
  "settlements",
  "settlement_time",
] as const;
export type AnalyticsMetricKey = (typeof ANALYTICS_METRICS)[number];

/** `usd_cents` and `count` are whole numbers; `ratio` is 0 to 1; `seconds` may be fractional. */
export type AnalyticsUnit = "usd_cents" | "count" | "ratio" | "seconds";

/** The longest range one request covers. */
export const ANALYTICS_MAX_DAYS = 366;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const day = z.string().regex(DAY, "Use a UTC day, YYYY-MM-DD").optional();

export const analyticsQuerySchema = z
  .object({
    /** First UTC day, inclusive. Default: 29 days before `to`. */
    from: day,
    /** Last UTC day, inclusive. Default: today. */
    to: day,
    interval: z.enum(ANALYTICS_INTERVALS).default("day"),
    /** Only payments paid on this network. */
    chain: z.string().min(1).optional(),
    /** Only payments the payer sent in this asset. */
    asset: z.string().min(1).optional(),
    /** Comma-separated metric keys. Default: all of them. */
    metrics: z
      .string()
      .optional()
      .transform((value) =>
        value === undefined ? undefined : value.split(",").map((m) => m.trim()),
      ),
  })
  .superRefine((query, ctx) => {
    const unknown = query.metrics?.filter(
      (key) => !(ANALYTICS_METRICS as readonly string[]).includes(key),
    );
    if (unknown !== undefined && unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["metrics"],
        message: `Unknown metric: ${unknown.join(", ")}`,
      });
    }
    if (query.from !== undefined && query.to !== undefined) {
      const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 + 1;
      if (!(days >= 1 && days <= ANALYTICS_MAX_DAYS)) {
        ctx.addIssue({
          code: "custom",
          path: ["from"],
          message: `The range must be 1 to ${ANALYTICS_MAX_DAYS} days, from on or before to`,
        });
      }
    }
  });

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface AnalyticsPointDto {
  /** The bucket's first UTC day. Weeks start on Monday. */
  readonly date: string;
  /** `null` when nothing in the bucket gives the figure a value, such as a rate with no checkouts. */
  readonly value: number | null;
}

export interface AnalyticsMetricDto {
  readonly key: AnalyticsMetricKey;
  readonly label: string;
  readonly unit: AnalyticsUnit;
  /** The figure for the whole range. */
  readonly total: number | null;
  /** Percent change against the range of the same length just before; `null` with nothing to compare. */
  readonly change: number | null;
  /** Every bucket in the range, the empty ones included. */
  readonly points: readonly AnalyticsPointDto[];
}

export interface AnalyticsShareDto {
  readonly key: string;
  readonly count: number;
  /** 0 to 1. */
  readonly share: number;
}

export interface AnalyticsPerformanceDto {
  readonly key: string;
  /** Payments that finished: completed, failed or expired. */
  readonly finished: number;
  /** 0 to 1. */
  readonly successRate: number;
  /** Median seconds from created to completed; `null` with no completed payment. */
  readonly medianSeconds: number | null;
}

export interface AnalyticsDto {
  readonly currency: "USD";
  readonly range: { readonly from: string; readonly to: string };
  readonly interval: AnalyticsInterval;
  readonly metrics: readonly AnalyticsMetricDto[];
  /** What completed payments in the range were paid with, and where from. Largest first. */
  readonly breakdowns: {
    readonly networks: readonly AnalyticsShareDto[];
    readonly assets: readonly AnalyticsShareDto[];
    /** ISO 3166 alpha-2, or `Unknown` for a payment that captured none. */
    readonly countries: readonly AnalyticsShareDto[];
  };
  /** Success rate and speed per network and per payer asset, busiest first. */
  readonly performance: {
    readonly networks: readonly AnalyticsPerformanceDto[];
    readonly assets: readonly AnalyticsPerformanceDto[];
  };
}
