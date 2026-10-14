const PATHS = {
  bank: <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />,
  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V8" />
      <path d="M4 7.5v10A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8h-12A2.5 2.5 0 0 1 4 5.5" />
      <circle cx="16" cy="13.5" r="1" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2.5v2.5M20 14v.01M14 20h.01M17 20h3v-3" />
    </>
  ),
  online: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M3 9h18M8 20h8M12 17v3" />
    </>
  ),
  crypto: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 8.5h3.5a1.75 1.75 0 0 1 0 3.5H9.5M9.5 12H13.5a1.75 1.75 0 0 1 0 3.5H9.5M9.5 8.5v7M11 7v1.500M11 15.500V17" />
    </>
  ),
} as const;

export type PaymentMethodKind = keyof typeof PATHS;

/** A small line glyph for a kind of payment method, drawn in the current colour. */
export function PaymentMethodIcon({
  kind,
  class: className = "size-4",
}: {
  readonly kind: PaymentMethodKind;
  readonly class?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={className}
    >
      {PATHS[kind]}
    </svg>
  );
}
