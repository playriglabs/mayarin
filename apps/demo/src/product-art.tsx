/**
 * Product imagery: flat-lay illustrations, garment shape × colorway.
 *
 * A coherent illustrated catalog instead of stock photos: every image shares
 * one frame (4:5, backdrop, ground shadow, hang tag). `metadata.kind` picks
 * the garment geometry and `metadata.tone` picks the palette, so two tees in
 * different colors stay distinct. Both ride the API's product metadata.
 */

interface Colorway {
  readonly backdrop: string;
  readonly body: string;
  readonly shade: string;
  readonly detail: string;
}

const TONES = {
  hitam: { backdrop: "#efe7da", body: "#232326", shade: "#161619", detail: "#ec4899" },
  arang: { backdrop: "#e9e6df", body: "#3f3f46", shade: "#2d2d33", detail: "#d7d3c9" },
  krem: { backdrop: "#33333a", body: "#e6dcc7", shade: "#cfc0a2", detail: "#232326" },
  hijau: { backdrop: "#e3e7e2", body: "#33523f", shade: "#294235", detail: "#efe7da" },
  bata: { backdrop: "#ece4d9", body: "#a34b3b", shade: "#7c382c", detail: "#efe1cf" },
  navy: { backdrop: "#e1e5ec", body: "#2c3a5a", shade: "#24304b", detail: "#c7cede" },
  olive: { backdrop: "#ece9df", body: "#6b6c4b", shade: "#585940", detail: "#4a4b35" },
  cokelat: { backdrop: "#e9e2d3", body: "#a9825a", shade: "#916e4b", detail: "#6f5138" },
  merah: { backdrop: "#ede4d6", body: "#a33b3b", shade: "#712c2c", detail: "#2b1a1a" },
} as const;

type Tone = keyof typeof TONES;

const KINDS = ["tee", "hoodie", "flannel", "cap", "jacket", "cargo"] as const;
export type ProductKind = (typeof KINDS)[number];

function isTone(value: string | undefined): value is Tone {
  return value !== undefined && value in TONES;
}

function isProductKind(value: string | undefined): value is ProductKind {
  return value !== undefined && (KINDS as readonly string[]).includes(value);
}

function Garment({
  kind,
  c,
  patternId,
}: {
  readonly kind: ProductKind;
  readonly c: Colorway;
  readonly patternId: string;
}) {
  switch (kind) {
    case "tee":
      return (
        <>
          <path
            d="M16 12 L24 8 Q32 12 40 8 L48 12 L54 22 L46 27 L46 54 L18 54 L18 27 L10 22 Z"
            fill={c.body}
          />
          <path d="M10 22 L18 27 L18 33 L13 26 Z" fill={c.shade} />
          <path d="M54 22 L46 27 L46 33 L51 26 Z" fill={c.shade} />
          <path d="M24 8 Q32 14 40 8 L38 10 Q32 15 26 10 Z" fill={c.shade} />
          <rect x="25" y="28" width="14" height="9" fill={c.detail} />
        </>
      );
    case "hoodie":
      return (
        <>
          <path
            d="M16 14 L24 9 Q32 4 40 9 L48 14 L54 24 L46 29 L46 54 L18 54 L18 29 L10 24 Z"
            fill={c.body}
          />
          <path d="M10 24 L18 29 L18 35 L13 28 Z" fill={c.shade} />
          <path d="M54 24 L46 29 L46 35 L51 28 Z" fill={c.shade} />
          <path d="M24 9 Q32 22 40 9 Q32 13 24 9 Z" fill={c.shade} />
          <path d="M26 40 L38 40 L36 50 L28 50 Z" fill={c.shade} />
          <path
            d="M30 18 L30 24 M34 18 L34 24"
            stroke={c.detail}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      );
    case "flannel":
      return (
        <>
          <path
            d="M16 12 L26 8 L32 14 L38 8 L48 12 L54 22 L46 27 L46 54 L18 54 L18 27 L10 22 Z"
            fill={`url(#${patternId})`}
          />
          <path d="M10 22 L18 27 L18 33 L13 26 Z" fill={c.shade} />
          <path d="M54 22 L46 27 L46 33 L51 26 Z" fill={c.shade} />
          <path d="M31 14 L33 14 L33 54 L31 54 Z" fill={c.detail} />
          <circle cx="32" cy="22" r="0.9" fill={c.backdrop} />
          <circle cx="32" cy="30" r="0.9" fill={c.backdrop} />
          <circle cx="32" cy="38" r="0.9" fill={c.backdrop} />
          <circle cx="32" cy="46" r="0.9" fill={c.backdrop} />
        </>
      );
    case "cap":
      return (
        <>
          <path d="M14 34 Q14 14 32 14 Q50 14 50 34 Z" fill={c.body} />
          <path d="M32 14 Q50 14 50 34 L42 34 Q42 18 32 14 Z" fill={c.shade} />
          <path d="M14 34 Q32 41 50 34 L50 37 Q32 44 14 37 Z" fill={c.detail} />
          <path d="M50 35 Q61 37 58 43 Q48 41 43 38 Z" fill={c.shade} />
          <path
            d="M22 18 Q20 26 20 33 M32 14 L32 34 M42 18 Q44 26 44 33"
            stroke={c.shade}
            strokeWidth="1"
          />
        </>
      );
    case "jacket":
      return (
        <>
          <path
            d="M16 12 L26 8 L32 16 L38 8 L48 12 L54 24 L46 28 L46 54 L18 54 L18 28 L10 24 Z"
            fill={c.body}
          />
          <path d="M10 24 L18 28 L18 34 L13 27 Z" fill={c.shade} />
          <path d="M54 24 L46 28 L46 34 L51 27 Z" fill={c.shade} />
          <path d="M26 8 L32 16 L38 8 L36 8 L32 13 L28 8 Z" fill={c.shade} />
          <path d="M31 16 L33 16 L33 54 L31 54 Z" fill={c.shade} />
          <circle cx="32" cy="22" r="1" fill={c.detail} />
          <circle cx="32" cy="30" r="1" fill={c.detail} />
          <circle cx="32" cy="38" r="1" fill={c.detail} />
          <circle cx="32" cy="46" r="1" fill={c.detail} />
          <path d="M18 50 L46 50 L46 54 L18 54 Z" fill={c.shade} />
        </>
      );
    case "cargo":
      return (
        <>
          <path d="M20 8 L44 8 L46 54 L36 54 L32 26 L28 54 L18 54 Z" fill={c.body} />
          <path d="M20 8 L44 8 L44.4 14 L19.7 14 Z" fill={c.shade} />
          <path d="M32 26 L36 54 L33 54 L31 32 Z" fill={c.shade} />
          <path d="M20.5 32 L27 32 L27 41 L20.8 41 Z" fill={c.detail} />
          <path d="M37 32 L43.5 32 L43.7 41 L37 41 Z" fill={c.detail} />
          <path d="M20.5 34 L27 34 M37 34 L43.5 34" stroke={c.shade} strokeWidth="1" />
        </>
      );
  }
}

export function ProductImage({
  kind,
  tone,
}: {
  readonly kind: string | undefined;
  readonly tone: string | undefined;
}) {
  const resolvedKind: ProductKind = isProductKind(kind) ? kind : "tee";
  const resolvedTone: Tone = isTone(tone) ? tone : "hitam";
  const c = TONES[resolvedTone];
  const patternId = `ps-check-${resolvedTone}`;
  return (
    <svg viewBox="0 0 400 500" role="img" aria-hidden="true" className="product-image">
      <defs>
        <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={c.body} />
          <rect width="4" height="8" fill={c.shade} />
          <rect y="4" width="8" height="4" fill={c.shade} opacity="0.55" />
          <rect width="4" height="4" y="4" fill={c.detail} opacity="0.85" />
        </pattern>
      </defs>
      <rect width="400" height="500" fill={c.backdrop} />
      <ellipse cx="200" cy="420" rx="130" ry="16" fill="#000000" opacity="0.08" />
      <g transform="translate(40 90) scale(5)">
        <Garment kind={resolvedKind} c={c} patternId={patternId} />
      </g>
      {/* Hang tag */}
      <g transform="translate(316 52) rotate(12)">
        <line x1="12" y1="-18" x2="12" y2="0" stroke="#9a9a92" strokeWidth="2" />
        <rect width="26" height="36" fill="#fffdf7" stroke="#d9d4c8" />
        <path d="M6 10 L20 10 L16.5 14 L9.5 14 Z" fill="#18181b" />
        <line x1="7" y1="22" x2="19" y2="22" stroke="#c9c4b8" strokeWidth="2" />
        <line x1="7" y1="27" x2="15" y2="27" stroke="#c9c4b8" strokeWidth="2" />
      </g>
    </svg>
  );
}
