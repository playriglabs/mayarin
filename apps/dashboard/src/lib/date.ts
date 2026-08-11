/**
 * Date rendering.
 *
 * The dashboard defaults to `id-ID`, matching how the payment API renders
 * money. Timestamps cross the wire as ISO strings and are shown in the
 * viewer's own timezone — a merchant reconciles against their own clock.
 */

const DATE_TIME = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const TIME = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** Machine-readable value for a `<time datetime>` attribute. */
export function isoAttr(iso: string): string {
  return new Date(iso).toISOString();
}
