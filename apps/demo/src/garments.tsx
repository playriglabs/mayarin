/**
 * Line-art garment illustrations, one per product kind.
 *
 * The seed writes `metadata.kind` on every product; the card picks its art
 * from that — showing an integrator that product metadata flows through the
 * API untouched. Inline SVG, stroke follows `currentColor`, no image assets.
 */

const ART = {
  tee: <path d="M16 12 L24 8 Q32 12 40 8 L48 12 L54 22 L46 27 L46 54 L18 54 L18 27 L10 22 Z" />,
  hoodie: (
    <>
      <path d="M16 14 L24 9 Q32 4 40 9 L48 14 L54 24 L46 29 L46 54 L18 54 L18 29 L10 24 Z" />
      <path d="M24 9 Q32 20 40 9" />
      <path d="M28 40 L28 54 M36 40 L36 54" />
    </>
  ),
  flannel: (
    <>
      <path d="M16 12 L26 8 L32 14 L38 8 L48 12 L54 22 L46 27 L46 54 L18 54 L18 27 L10 22 Z" />
      <path d="M32 14 L32 54" />
      <path d="M18 34 L46 34 M18 44 L46 44" />
    </>
  ),
  cap: (
    <>
      <path d="M14 34 Q14 16 32 16 Q50 16 50 34 Z" />
      <path d="M14 34 Q32 40 50 34" />
      <path d="M50 34 Q60 36 58 42 Q48 40 44 37" />
      <path d="M32 16 L32 34" />
    </>
  ),
  jacket: (
    <>
      <path d="M16 12 L26 8 L32 16 L38 8 L48 12 L54 24 L46 28 L46 54 L18 54 L18 28 L10 24 Z" />
      <path d="M26 8 L26 54 M38 8 L38 54" />
      <path d="M18 30 L26 30 M38 30 L46 30" />
    </>
  ),
  cargo: (
    <>
      <path d="M20 8 L44 8 L46 54 L36 54 L32 26 L28 54 L18 54 Z" />
      <path d="M20 16 L44 16" />
      <path d="M21 34 L27 34 L27 42 L21 42 Z M37 34 L43 34 L43 42 L37 42 Z" />
    </>
  ),
} as const;

export type GarmentKind = keyof typeof ART;

const FALLBACK = (
  // A hanger, for a product whose metadata names no known kind.
  <>
    <path d="M32 12 Q38 12 38 17 Q38 21 32 23 L32 28" />
    <path d="M32 28 L8 46 L56 46 Z" />
  </>
);

export function isGarmentKind(value: string | undefined): value is GarmentKind {
  return value !== undefined && value in ART;
}

export function GarmentArt({ kind }: { readonly kind: string | undefined }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {isGarmentKind(kind) ? ART[kind] : FALLBACK}
    </svg>
  );
}
