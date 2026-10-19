/**
 * Request body ceilings for the two APIs (SEC-08).
 *
 * Bun accepts 128 MB per request unless told otherwise, and reads all of it
 * before a handler runs, so an unauthenticated caller could make either API
 * buffer that much on every request. The ceiling is set on the server, where it
 * also covers a chunked body that never declares a length.
 *
 * Every body either API reads is JSON, except the dashboard's merchant logo,
 * which is the one raw upload and has its own cap in the service that stores it.
 */

/** JSON bodies: a payment, a webhook endpoint, a dispute message. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Headroom over a raw upload's own cap, so that cap is what refuses it, with its message. */
export const bodyCeilingFor = (largestUploadBytes: number): number =>
  Math.max(MAX_JSON_BODY_BYTES, largestUploadBytes + 64 * 1024);
