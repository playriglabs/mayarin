/**
 * Date rendering.
 *
 * The dashboard uses `en-US` for readable English month names and US date/time
 * punctuation. Timestamps cross the wire as ISO strings and are shown in the
 * viewer's own timezone — a merchant reconciles against their own clock.
 */

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const TIME = new Intl.DateTimeFormat("en-US", {
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
