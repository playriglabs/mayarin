/**
 * Error reporting to Sentry.
 *
 * Every service already logs a failure with `console.error`, so that is what
 * gets reported: one hook covers the request handlers, the worker's timers and
 * anything added later, without a `report()` call beside each log line.
 *
 * Off unless `SENTRY_DSN` is set, so a laptop and the test suite send nothing.
 */

import * as Sentry from "@sentry/bun";

const REPEAT_WINDOW_MS = 60_000;

/**
 * A refused request is an answer, not an incident: the payment API logs every
 * 4xx as `[api] POST /path -> 400 CODE: ...`, and those would bury the real ones.
 */
const CLIENT_ERROR_LOG = /-> 4\d\d /;

/**
 * Decides which console errors become Sentry events: not a client error, and not
 * the same message again within a minute (a timer that fails every few seconds
 * would otherwise spend the monthly quota in a day).
 */
export function createErrorFilter(now: () => number): (message: string) => boolean {
  const lastSent = new Map<string, number>();
  return (message) => {
    if (CLIENT_ERROR_LOG.test(message)) return false;
    const at = now();
    const previous = lastSent.get(message);
    if (previous !== undefined && at - previous < REPEAT_WINDOW_MS) return false;
    lastSent.set(message, at);
    return true;
  };
}

export function initErrorReporting(service: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (dsn === undefined || dsn === "") return;
  const shouldSend = createErrorFilter(Date.now);
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    initialScope: { tags: { service } },
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
    beforeSend: (event) =>
      shouldSend(event.message ?? event.exception?.values?.[0]?.value ?? "") ? event : null,
  });
  console.log(`[${service}] error reporting enabled`);
}
