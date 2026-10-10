import type { ReactNode } from "react";
import { Brand } from "./brand.tsx";
import { SummaryColumn } from "./checkout-shell.tsx";
import type { LineItem, MerchantRef } from "./types.ts";

/** A long cart stays a summary: the first few lines, then a count of the rest. */
export const VISIBLE_LINES = 5;

/** One line of the price breakdown. The last row is the one being paid. */
export interface SummaryRow {
  readonly label: string;
  readonly value: string;
}

/**
 * What is being bought, on the left of both checkout pages. The link page and
 * the payment page show the same summary so the buyer sees one order across the
 * two steps, not two descriptions of it.
 */
export function CheckoutSummary({
  merchant,
  title,
  totalDisplay,
  lines,
  priceSuffix,
  details,
  breakdown,
  label = "Order summary",
  children,
}: {
  readonly merchant: MerchantRef;
  readonly title: string;
  readonly totalDisplay: string;
  readonly lines: readonly LineItem[] | null;
  /** After the big figure, e.g. "/ mo" for a subscription. */
  readonly priceSuffix?: string;
  /** Short label–value facts under the price: invoice number, who is billed, due date. */
  readonly details?: readonly SummaryRow[];
  /** Defaults to a single Total row. */
  readonly breakdown?: readonly SummaryRow[];
  /** What the column is, for a screen reader. */
  readonly label?: string;
  /** Page-specific content under the order, e.g. the payment's progress. */
  readonly children?: ReactNode;
}) {
  const shown = lines?.slice(0, VISIBLE_LINES) ?? [];
  const hidden = (lines?.length ?? 0) - shown.length;
  const rows = breakdown ?? [{ label: "Total", value: totalDisplay }];

  return (
    <SummaryColumn label={label}>
      <Brand
        merchant={merchant}
        label={merchant.city.trim() === "" ? merchant.name : `${merchant.name} — ${merchant.city}`}
      />
      <h1 className="mt-8 mb-0 text-base font-normal text-ink">{title}</h1>
      <p className="mt-1 mb-0 text-4xl leading-tight tracking-[-0.02em] text-ink tabular-nums">
        {totalDisplay}
        {priceSuffix !== undefined && (
          <span className="ml-1.5 text-base tracking-normal text-muted">{priceSuffix}</span>
        )}
      </p>
      {details !== undefined && details.length > 0 && (
        <dl className="mt-5 mb-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          {details.map((row) => (
            <div className="contents" key={row.label}>
              <dt className="text-muted">{row.label}</dt>
              <dd className="m-0 text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {shown.length > 0 && (
        <div className="mt-8 flex flex-col gap-5">
          {shown.map((line) => (
            <article
              className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-4"
              key={`${line.name}-${line.unitPrice.amount}`}
            >
              {line.imageUrl === null ? (
                <div
                  className="grid size-14 place-items-center rounded-xl border border-line bg-panel text-lg text-muted"
                  aria-hidden="true"
                >
                  {line.name.slice(0, 1).toUpperCase()}
                </div>
              ) : (
                <img
                  className="size-14 rounded-xl border border-line bg-panel object-cover"
                  src={line.imageUrl}
                  alt=""
                  width="56"
                  height="56"
                  loading="lazy"
                  decoding="async"
                />
              )}
              <div className="min-w-0">
                <div className="flex justify-between gap-4 text-sm text-ink">
                  <span>{line.name}</span>
                  <span className="whitespace-nowrap tabular-nums">{line.lineTotal.display}</span>
                </div>
                {line.description !== null && (
                  <p className="mt-0.5 mb-0 line-clamp-2 text-xs text-muted">{line.description}</p>
                )}
                <span className="mt-0.5 block text-xs text-muted">
                  {line.unitPrice.display} × {line.quantity}
                </span>
              </div>
            </article>
          ))}
          {hidden > 0 && (
            <p className="m-0 text-sm text-muted">
              +{hidden} more {hidden === 1 ? "item" : "items"}
            </p>
          )}
        </div>
      )}

      <dl className="mt-8 mb-0 flex flex-col gap-2.5 border-t border-line pt-5 text-sm">
        {rows.map((row, index) => {
          const last = index === rows.length - 1;
          return (
            <div className="flex justify-between gap-4" key={row.label}>
              <dt className={last ? "text-ink" : "text-muted"}>{row.label}</dt>
              <dd className={`m-0 tabular-nums ${last ? "text-ink" : "text-muted"}`}>
                {row.value}
                {last && priceSuffix !== undefined && (
                  <span className="ml-1 text-xs text-muted">{priceSuffix}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {children}
    </SummaryColumn>
  );
}
