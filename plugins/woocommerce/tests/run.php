<?php
/**
 * Plain-PHP tests for the plugin's pure functions. No WordPress, no PHPUnit.
 *
 * Run from the repo root:
 *   bun run test:woocommerce
 * or directly:
 *   docker run --rm -v "$PWD/plugins/woocommerce":/plugin -w /plugin php:8.3-cli php tests/run.php
 */

// The includes guard on ABSPATH; define it so they load outside WordPress.
define('ABSPATH', '/');
define('MAYARIN_API_VERSION', '2026-08-11');
define('MAYARIN_PLUGIN_VERSION', '0.1.0');

require __DIR__ . '/../includes/mayarin-signature.php';
require __DIR__ . '/../includes/mayarin-webhook.php';
require __DIR__ . '/../includes/class-mayarin-client.php';

$failures = 0;
$passes   = 0;

function check(string $name, bool $condition): void {
    global $failures, $passes;
    if ($condition) {
        $passes++;
        return;
    }
    $failures++;
    fwrite(STDERR, "FAIL: {$name}\n");
}

/** Signs the way the API does: `t=<unix>,v1=<hmac(secret, "t.body")>`. */
function sign(string $body, string $secret, int $timestamp): string {
    return 't=' . $timestamp . ',v1=' . hash_hmac('sha256', $timestamp . '.' . $body, $secret);
}

// --- mayarin_parse_signature_header ---

$parsed = mayarin_parse_signature_header('t=1700000000,v1=aa,v1=bb');
check('parse: reads the timestamp', $parsed !== null && $parsed['timestamp'] === 1700000000);
check('parse: reads every v1 signature', $parsed !== null && $parsed['signatures'] === ['aa', 'bb']);
check('parse: refuses a header with no timestamp', mayarin_parse_signature_header('v1=aa') === null);
check('parse: refuses a header with no signature', mayarin_parse_signature_header('t=1700000000') === null);
check('parse: refuses a non-numeric timestamp', mayarin_parse_signature_header('t=abc,v1=aa') === null);
check('parse: refuses an empty header', mayarin_parse_signature_header('') === null);
check('parse: skips malformed parts', mayarin_parse_signature_header('junk,t=5,v1=aa') !== null);

// --- mayarin_verify_webhook ---

$body   = '{"id":"evt_1","type":"payment.state_changed"}';
$secret = 'whsec_test';
$now    = 1700000000;

check('verify: accepts a valid signature', mayarin_verify_webhook(sign($body, $secret, $now), $body, $secret, $now));
check('verify: refuses the wrong secret', !mayarin_verify_webhook(sign($body, 'other', $now), $body, $secret, $now));
check('verify: refuses a tampered body', !mayarin_verify_webhook(sign($body, $secret, $now), $body . 'x', $secret, $now));
check('verify: refuses a stale timestamp', !mayarin_verify_webhook(sign($body, $secret, $now - 301), $body, $secret, $now));
check('verify: accepts the tolerance boundary', mayarin_verify_webhook(sign($body, $secret, $now - 300), $body, $secret, $now));
check('verify: refuses a future timestamp past tolerance', !mayarin_verify_webhook(sign($body, $secret, $now + 301), $body, $secret, $now));

// A rotation: the header carries a signature per active secret; one match verifies.
$rotated = 't=' . $now
    . ',v1=' . hash_hmac('sha256', $now . '.' . $body, 'whsec_new')
    . ',v1=' . hash_hmac('sha256', $now . '.' . $body, $secret);
check('verify: accepts the second signature after a rotation', mayarin_verify_webhook($rotated, $body, $secret, $now));

// --- mayarin_decide_order_action ---

function event(string $state, int $sequence, string $intent = 'pi_1'): array {
    return [
        'id'   => 'evt_' . $sequence,
        'type' => 'payment.state_changed',
        'data' => [
            'paymentIntentId'       => $intent,
            'clearingTransactionId' => 'clr_1',
            'state'                 => $state,
            'sequence'              => $sequence,
            'metadata'              => ['wc_order_id' => '7'],
        ],
    ];
}

check('decide: SUCCESS marks the order paid', mayarin_decide_order_action(event('SUCCESS', 9), 'pi_1', 8)['action'] === 'paid');
check('decide: FAILED marks the order failed', mayarin_decide_order_action(event('FAILED', 9), 'pi_1', 8)['action'] === 'failed');
check('decide: an intermediate state becomes a note', mayarin_decide_order_action(event('CLEARING', 9), 'pi_1', 8)['action'] === 'note');
check('decide: a stale sequence is ignored', mayarin_decide_order_action(event('SUCCESS', 8), 'pi_1', 8)['action'] === 'ignore');
check('decide: a replayed sequence is ignored', mayarin_decide_order_action(event('SUCCESS', 8), 'pi_1', 9)['action'] === 'ignore');
check('decide: a mismatched intent id is ignored', mayarin_decide_order_action(event('SUCCESS', 9, 'pi_other'), 'pi_1', 8)['action'] === 'ignore');
check('decide: an order with no intent is ignored', mayarin_decide_order_action(event('SUCCESS', 9), '', 0)['action'] === 'ignore');
check('decide: a malformed event is ignored', mayarin_decide_order_action(['data' => []], 'pi_1', 0)['action'] === 'ignore');
check('decide: a string sequence is ignored', mayarin_decide_order_action(
    ['data' => ['paymentIntentId' => 'pi_1', 'state' => 'SUCCESS', 'sequence' => '9']],
    'pi_1',
    0
)['action'] === 'ignore');

// --- mayarin_api_error_message ---

check(
    'error: names the code and message',
    mayarin_api_error_message(422, ['error' => ['code' => 'AMOUNT_TOO_SMALL', 'message' => 'Too small']])
        === 'Mayarin API error AMOUNT_TOO_SMALL: Too small'
);
check(
    'error: a version refusal tells the merchant to update',
    strpos(
        mayarin_api_error_message(400, ['error' => ['code' => 'UNSUPPORTED_VERSION', 'message' => 'Gone']]),
        'Update the Mayarin Payments plugin'
    ) !== false
);
check(
    'error: a non-JSON body falls back to the status',
    mayarin_api_error_message(502, null) === 'Mayarin API returned HTTP 502.'
);
check(
    'error: a JSON body without the error shape falls back to the status',
    mayarin_api_error_message(500, ['message' => 'nope']) === 'Mayarin API returned HTTP 500.'
);

// --- result ---

echo $passes . ' passed, ' . $failures . " failed\n";
exit($failures === 0 ? 0 : 1);
