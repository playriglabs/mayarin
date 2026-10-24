import type { ReactNode } from "react";
import { useT } from "../i18n/index.tsx";
import { LanguageSwitcher } from "./language-switcher.tsx";
import { PoweredBy } from "./powered-by.tsx";

/**
 * A testnet's buyer pages say so across the top: test assets, no real-world value,
 * so nobody sends mainnet funds to a testnet address. A mainnet's say nothing. The
 * API puts the network in the bootstrap; without it the page assumes a testnet, so
 * a missing flag errs toward the warning. No dash and no icon: the strings this
 * page renders are pinned by tests that forbid both.
 */
export function TestnetBanner() {
  const t = useT();
  if (typeof window !== "undefined" && window.__BOOTSTRAP__?.network === "mainnet") return null;
  return (
    <p className="m-0 bg-banner px-4 py-2.5 text-center text-sm text-banner-ink print:hidden">
      {t("testnetBanner")}
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
          className="flex justify-center bg-panel px-5 py-10 sm:px-8 lg:justify-start lg:px-14 lg:py-12 xl:px-24 print:hidden"
        >
          <div className="flex w-full max-w-md flex-col">{children}</div>
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
      className="flex justify-center border-b border-line bg-page px-5 py-8 sm:px-8 lg:justify-end lg:border-b-0 lg:px-14 lg:py-12 xl:px-24 print:block print:border-0 print:bg-white print:p-0"
    >
      <div className="w-full max-w-md print:max-w-none">
        {/* First thing in the column, above the merchant, on the same left edge. */}
        <div className="mb-8 flex items-center justify-between gap-4 print:hidden">
          <PoweredBy align="start" />
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </aside>
  );
}
