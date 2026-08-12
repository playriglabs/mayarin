<?php
/**
 * The webhook receiver.
 *
 * Order status is driven from here, never from the buyer returning to the
 * store — a buyer who closes the tab still gets their order marked paid.
 *
 * Deliveries are at-least-once and unordered. `mayarin_decide_order_action`
 * is the pure decision: it guards on the event's `sequence` against the
 * highest sequence the order has seen, so a stale or replayed delivery is
 * discarded instead of trusted.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Decides what one webhook event does to one order. Pure; tested without
 * WordPress. The caller loads the order state and applies the action.
 *
 * @param array       $event            Decoded delivery body.
 * @param string|null $stored_intent_id The intent id the order was minted with.
 * @param int         $last_sequence    Highest sequence the order has seen.
 * @return array `['action' => 'ignore'|'paid'|'failed'|'note', 'reason' => string]`
 */
function mayarin_decide_order_action(array $event, ?string $stored_intent_id, int $last_sequence): array {
    $data = isset($event['data']) && is_array($event['data']) ? $event['data'] : null;
    if (
        $data === null
        || !isset($data['paymentIntentId'], $data['state'], $data['sequence'])
        || !is_int($data['sequence'])
    ) {
        return ['action' => 'ignore', 'reason' => 'malformed event'];
    }

    if ($stored_intent_id === null || $stored_intent_id === '') {
        return ['action' => 'ignore', 'reason' => 'order carries no Mayarin payment'];
    }

    if ($data['paymentIntentId'] !== $stored_intent_id) {
        return ['action' => 'ignore', 'reason' => 'payment intent id does not match the order'];
    }

    if ($data['sequence'] <= $last_sequence) {
        return ['action' => 'ignore', 'reason' => 'stale sequence'];
    }

    switch ($data['state']) {
        case 'SUCCESS':
            return ['action' => 'paid', 'reason' => 'payment settled'];
        case 'FAILED':
            return ['action' => 'failed', 'reason' => 'payment failed'];
        default:
            return ['action' => 'note', 'reason' => 'state ' . $data['state']];
    }
}

/**
 * The REST callback behind `POST /wp-json/mayarin/v1/webhook`.
 *
 * A delivery the store cannot match is acknowledged with 200: a retry will
 * not fix it, and an unmatched event must not make Mayarin retry forever.
 * Only a bad signature or missing configuration refuses the delivery.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function mayarin_handle_webhook_request($request) {
    $secret = mayarin_webhook_secret();
    if ($secret === '') {
        return new WP_REST_Response(['error' => 'The webhook signing secret is not configured.'], 503);
    }

    $body   = (string) $request->get_body();
    $header = (string) $request->get_header('webhook-signature');
    if (!mayarin_verify_webhook($header, $body, $secret, time())) {
        return new WP_REST_Response(['error' => 'Signature verification failed.'], 401);
    }

    $event = json_decode($body, true);
    if (!is_array($event)) {
        return new WP_REST_Response(['error' => 'The body is not a JSON object.'], 400);
    }

    $order_id = isset($event['data']['metadata']['wc_order_id'])
        ? (int) $event['data']['metadata']['wc_order_id']
        : 0;
    $order = $order_id > 0 ? wc_get_order($order_id) : false;
    if (!$order) {
        return new WP_REST_Response(['received' => true, 'handled' => false, 'reason' => 'no matching order'], 200);
    }

    $decision = mayarin_decide_order_action(
        $event,
        (string) $order->get_meta('_mayarin_payment_intent_id'),
        (int) $order->get_meta('_mayarin_webhook_sequence')
    );

    if ($decision['action'] === 'ignore') {
        return new WP_REST_Response(['received' => true, 'handled' => false, 'reason' => $decision['reason']], 200);
    }

    $state = (string) $event['data']['state'];
    switch ($decision['action']) {
        case 'paid':
            $order->payment_complete((string) $event['data']['paymentIntentId']);
            $order->add_order_note(__('Mayarin: payment settled.', 'mayarin-payments'));
            break;
        case 'failed':
            /* translators: %s: the clearing state. */
            $order->update_status('failed', __('Mayarin: payment failed.', 'mayarin-payments'));
            break;
        case 'note':
            /* translators: %s: the clearing state. */
            $order->add_order_note(sprintf(__('Mayarin: payment moved to %s.', 'mayarin-payments'), $state));
            break;
    }

    $order->update_meta_data('_mayarin_webhook_sequence', (int) $event['data']['sequence']);
    $order->save();

    return new WP_REST_Response(['received' => true, 'handled' => true], 200);
}

/** Reads the signing secret from the gateway settings without instantiating the gateway. */
function mayarin_webhook_secret(): string {
    $settings = get_option('woocommerce_mayarin_settings');
    if (!is_array($settings) || !isset($settings['webhook_secret'])) {
        return '';
    }
    return (string) $settings['webhook_secret'];
}
