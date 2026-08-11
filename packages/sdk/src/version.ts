/**
 * The API version this SDK build targets.
 *
 * Every request carries it as `Mayarin-Version`. The API ignores the header
 * today; a later change can enforce it, and a client pinned to a stale date
 * then fails legibly instead of silently (#14).
 */

export const MAYARIN_VERSION = "2026-08-11";

/** Package identity sent as `User-Agent` where the runtime allows it. */
export const SDK_NAME = "@mayarin/sdk";
export const SDK_VERSION = "0.1.0";
