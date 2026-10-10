import type { ReactNode } from "react";
import { PoweredBy } from "./powered-by.tsx";

/**
 * Every buyer page sits on a testnet: test assets, no real-world value. Said
 * across the top of the page, the way the dashboard says it, so nobody sends
 * mainnet funds to a testnet address. No dash and no icon: the strings this
 * page renders are pinned by tests that forbid both.
 */
export function TestnetBanner() {
  return (
    <p className="m-0 bg-banner px-4 py-2.5 text-center text-sm text-banner-ink print:hidden">
      Mayarin Testnet ─ Payments use test assets and have no real-world value
    </p>
  );
}

/**
 * The split checkout, after Polar's: the order on the left ground, the payment
 * on the right panel, each column's content hugging the seam between them.
 * Stacked, order first, below the `lg` width.
 */
export function CheckoutShell({
  summary,
  label,
  children,
}: {
  /** The left column: usually `CheckoutSummary`, the invoice's document. */
  readonly summary: ReactNode;
  /** What the right column is, for a screen reader. */
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TestnetBanner />
      <main className="grid flex-1 grid-cols-1 lg:grid-cols-2 print:block">
        {summary}
        <section
          aria-label={label}
          className="flex justify-center bg-panel px-5 py-10 sm:px-8 lg:justify-start lg:px-14 lg:py-16 xl:px-24 print:hidden"
        >
          <div className="flex w-full max-w-md flex-col">
            {children}
            <div className="min-h-12 flex-1" />
            <PoweredBy />
          </div>
        </section>
      </main>
    </div>
  );
}

/** The left column's ground. Its content sits against the seam on a wide screen. */
export function SummaryColumn({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="flex justify-center border-b border-line bg-page px-5 py-8 sm:px-8 lg:justify-end lg:border-b-0 lg:px-14 lg:py-16 xl:px-24 print:block print:border-0 print:bg-white print:p-0"
    >
      <div className="w-full max-w-md print:max-w-none">{children}</div>
    </aside>
  );
}
