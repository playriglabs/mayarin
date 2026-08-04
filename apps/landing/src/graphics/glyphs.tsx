import type { JSX } from "preact";

type GlyphProps = JSX.SVGAttributes<SVGSVGElement>;

function Glyph({ children, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width="32"
      height="32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Line-only marks: rails, nodes and routes. No coins, no cubes, no wallets. */
export const glyphs = {
  orchestration: (
    <Glyph>
      <path d="M3 8h9c3 0 4 8 7 8h10M3 24h9c3 0 4-8 7-8" />
      <circle cx="19" cy="16" r="2" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
  /** A predicate on the rail: the condition resolves and one branch is taken. */
  settlement: (
    <Glyph>
      <path d="M2 16h5" />
      <path d="M12 11l5 5-5 5-5-5z" />
      <path d="M17 16c6 0 5-9 11-9" />
      <path d="M17 16c6 0 5 9 11 9" stroke-dasharray="2 3" />
      <circle cx="28" cy="7" r="2" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
  /** Two sides that have to come out level — balances, then reconciliation. */
  treasury: (
    <Glyph>
      <path d="M16 6v19M6 11h20M11 25h10" />
      <path d="M6 11v2M26 11v2" />
      <path d="M2 13a4 4 0 0 0 8 0M22 13a4 4 0 0 0 8 0" />
      <circle cx="16" cy="11" r="2" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
  ledger: (
    <Glyph>
      <path d="M16 4v24M6 11h6M6 19h6M20 11h6M20 19h6" />
    </Glyph>
  ),
  routing: (
    <Glyph>
      <path d="M3 6h6c4 0 4 10 8 10h12M3 26h6c4 0 4-10 8-10" />
      <path d="M25 12l4 4-4 4" />
    </Glyph>
  ),
  qr: (
    <Glyph>
      <path d="M4 10V4h6M22 4h6v6M28 22v6h-6M10 28H4v-6" />
      <rect x="12" y="12" width="8" height="8" />
    </Glyph>
  ),
  api: (
    <Glyph>
      <path d="M11 9l-7 7 7 7M21 9l7 7-7 7M18 7l-4 18" />
    </Glyph>
  ),
  sdk: (
    <Glyph>
      <rect x="9" y="3" width="14" height="26" rx="2" />
      <path d="M9 24h14" />
      <circle cx="16" cy="9" r="2" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
  /** Each transition returns a new value; the versions behind it still stand. */
  intent: (
    <Glyph>
      <path d="M7.6 22.4l5.8-4.8M18.6 13.4l5.8-4.8" />
      <circle cx="5" cy="25" r="3.2" />
      <circle cx="16" cy="16" r="3.2" />
      <circle cx="27" cy="7" r="3.2" />
      <circle cx="27" cy="7" r="1.6" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
  adapters: (
    <Glyph>
      <rect x="3" y="11" width="10" height="10" />
      <rect x="19" y="11" width="10" height="10" />
      <path d="M13 16h6" />
    </Glyph>
  ),
  /** States around a cycle, one of them current — resumable from wherever it stopped. */
  clearing: (
    <Glyph>
      <path d="M16 5A11 11 0 1 1 5 16" />
      <circle cx="16" cy="5" r="2" />
      <circle cx="27" cy="16" r="2" />
      <circle cx="16" cy="27" r="2" />
      <circle cx="5" cy="16" r="2.25" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
  /** A one-way gate: replay it as often as you like, value passes exactly once. */
  engine: (
    <Glyph>
      <path d="M2 16h10" />
      <path d="M12 10l8 6-8 6z" />
      <path d="M20 10v12" />
      <path d="M20 16h6" />
      <circle cx="27" cy="16" r="2" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
} as const;

export type GlyphName = keyof typeof glyphs;
