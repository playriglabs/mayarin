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
  /**
   * The machine payer: a processor with the page's accent square at its core
   * and pins on every side. It reads as a program rather than a person, which
   * is the whole distinction the card is making.
   */
  agent: (
    <Glyph>
      <rect x="9" y="9" width="14" height="14" />
      <rect x="14" y="14" width="4" height="4" fill="var(--color-accent)" stroke="none" />
      <path d="M13 2v7M19 2v7M13 23v7M19 23v7M2 13h7M2 19h7M23 13h7M23 19h7" />
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

/** Familiar outline symbols for principles, matching the use-case illustrations. */
function PrincipleGlyph({ children, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width="32"
      height="32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const principleGlyphs = {
  /** A route between endpoints: infrastructure handles the journey. */
  abstractRail: (
    <PrincipleGlyph>
      <circle cx="6" cy="7" r="3" />
      <circle cx="26" cy="25" r="3" />
      <path d="M9 7h11a4.5 4.5 0 0 1 0 9h-8a4.5 4.5 0 0 0 0 9h11" />
    </PrincipleGlyph>
  ),
  /** Detachable plugs: a provider can be replaced at the connection. */
  providerAgnostic: (
    <PrincipleGlyph>
      <path d="m3 29 5-5m16-16 5-5" />
      <path d="m5 19 8 8 3-3a5.7 5.7 0 0 0-8-8Zm11-11 3-3 8 8-3 3a5.7 5.7 0 0 1-8-8Z" />
      <path d="m12 16 3-3m1 7 3-3" />
    </PrincipleGlyph>
  ),
  /** Sliders: settlement conditions are configurable. */
  programmable: (
    <PrincipleGlyph>
      <path d="M4 7h5m6 0h13M4 16h15m6 0h3M4 25h5m6 0h13" />
      <circle cx="12" cy="7" r="3" />
      <circle cx="22" cy="16" r="3" />
      <circle cx="12" cy="25" r="3" />
    </PrincipleGlyph>
  ),
  /** Two sides of one book: every posting lands on both, or on neither. */
  oneLedger: (
    <PrincipleGlyph>
      <path d="M16 8c-4-3-8-3-13-2v21c5-1 9-1 13 2 4-3 8-3 13-2V6c-5-1-9-1-13 2Z" />
      <path d="M16 8v21M7 12c2-.3 4 0 5 1m-5 5c2-.3 4 0 5 1m8-6c1-1 3-1.3 5-1m-5 7c1-1 3-1.3 5-1" />
    </PrincipleGlyph>
  ),
  /** A chain link with a check: settlement requires verified chain evidence. */
  onChainTruth: (
    <PrincipleGlyph>
      <path d="m13 10 4-4a6 6 0 0 1 8.5 8.5L22 18M18 15l-4 4M19 22l-4 4A6 6 0 0 1 6.5 17.5L10 14" />
      <path d="m22 25 3 3 5-6" />
    </PrincipleGlyph>
  ),
  /** A shield and lock: an explicit perimeter around custody. */
  explicitCustody: (
    <PrincipleGlyph>
      <path d="M16 3c3 3 7 4 11 5v8c0 6-5 10-11 13C10 26 5 22 5 16V8c4-1 8-2 11-5Z" />
      <rect x="11" y="14" width="10" height="8" rx="1.5" />
      <path d="M13 14v-3a3 3 0 0 1 6 0v3m-3 4v1" />
    </PrincipleGlyph>
  ),
  /** Puzzle pieces: independent parts fit together through defined interfaces. */
  compose: (
    <PrincipleGlyph>
      <path d="M4 7h8V5a3 3 0 0 1 6 0v2h10v9h-2a3 3 0 0 0 0 6h2v6H4v-8h2a3 3 0 0 0 0-6H4Z" />
      <path d="M16 7v7h2a3 3 0 0 1 0 6h-2v8" />
    </PrincipleGlyph>
  ),
} as const;

export type PrincipleGlyphName = keyof typeof principleGlyphs;
