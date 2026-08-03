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
  settlement: (
    <Glyph>
      <path d="M3 16h11m4 0h11" />
      <rect x="12" y="10" width="8" height="12" />
      <path d="M23 12l4 4-4 4" />
    </Glyph>
  ),
  treasury: (
    <Glyph>
      <path d="M4 9h24M4 16h17M4 23h20" />
      <circle cx="27" cy="16" r="2" fill="var(--color-accent)" stroke="none" />
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
  intent: (
    <Glyph>
      <circle cx="16" cy="16" r="12" stroke-dasharray="2 4" />
      <circle cx="16" cy="16" r="6" />
      <circle cx="16" cy="16" r="1.75" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
  adapters: (
    <Glyph>
      <rect x="3" y="11" width="10" height="10" />
      <rect x="19" y="11" width="10" height="10" />
      <path d="M13 16h6" />
    </Glyph>
  ),
  clearing: (
    <Glyph>
      <path d="M6 26a14 14 0 0 1 20-20" />
      <path d="M26 6v7h-7" />
      <circle cx="16" cy="16" r="2.25" fill="var(--color-accent)" stroke="none" />
      <path d="M4 16h8m8 0h8" stroke-dasharray="2 4" />
    </Glyph>
  ),
  engine: (
    <Glyph>
      <rect x="4" y="8" width="24" height="16" />
      <path d="M4 14h24M11 8v6M21 8v6" />
      <circle cx="16" cy="19" r="2" fill="var(--color-accent)" stroke="none" />
    </Glyph>
  ),
} as const;

export type GlyphName = keyof typeof glyphs;
