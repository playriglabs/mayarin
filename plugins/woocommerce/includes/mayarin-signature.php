<?php
/**
 * Webhook signature verification.
 *
 * Mirrors `packages/core/notifications/src/signature.ts`: HMAC-SHA256 over
 * `{timestamp}.{body}`. The `Webhook-Signature` header carries the timestamp
 * it was signed with (`t=`) plus one `v1=` signature per active secret, so a
 * rotation keeps old deliveries verifiable.
 *
 * Pure functions: no WordPress, no I/O. The caller injects the clock.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Bound on how old a delivery's timestamp may be, in seconds. */
const MAYARIN_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Parses `t=<unix>,v1=<hex>[,v1=<hex>]`.
 *
 * Returns `['timestamp' => int, 'signatures' => string[]]`, or `null` when
 * the header does not carry both parts.
 */
function mayarin_parse_signature_header(string $header): ?array {
    $timestamp  = null;
    $signatures = [];

    foreach (explode(',', $header) as $part) {
        $pair = explode('=', $part, 2);
        if (count($pair) !== 2) {
            continue;
        }
        if ($pair[0] === 't' && ctype_digit($pair[1])) {
            $timestamp = (int) $pair[1];
        }
        if ($pair[0] === 'v1' && $pair[1] !== '') {
            $signatures[] = $pair[1];
        }
    }

    if ($timestamp === null || $signatures === []) {
        return null;
    }

    return ['timestamp' => $timestamp, 'signatures' => $signatures];
}

/**
 * Verifies one delivery.
 *
 * `$now` is unix seconds, injected so tests control the clock. A timestamp
 * outside the tolerance window fails: a captured delivery cannot be replayed
 * later, and a tampered body never verifies.
 */
function mayarin_verify_webhook(
    string $header,
    string $body,
    string $secret,
    int $now,
    int $tolerance = MAYARIN_WEBHOOK_TOLERANCE_SECONDS
): bool {
    $parsed = mayarin_parse_signature_header($header);
    if ($parsed === null) {
        return false;
    }

    if (abs($now - $parsed['timestamp']) > $tolerance) {
        return false;
    }

    $expected = hash_hmac('sha256', $parsed['timestamp'] . '.' . $body, $secret);
    foreach ($parsed['signatures'] as $candidate) {
        if (hash_equals($expected, $candidate)) {
            return true;
        }
    }

    return false;
}
