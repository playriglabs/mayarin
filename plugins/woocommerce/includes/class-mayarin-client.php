<?php
/**
 * Thin HTTP client for the public Mayarin API.
 *
 * Every request carries the pinned `Mayarin-Version` header. When the API
 * refuses the version, the error message tells the merchant to update the
 * plugin instead of failing silently — a plugin runs for years after it is
 * installed.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Mayarin_Client {

    private string $base_url;
    private string $secret_key;

    public function __construct(string $base_url, string $secret_key) {
        $this->base_url   = rtrim($base_url, '/');
        $this->secret_key = $secret_key;
    }

    /**
     * `POST /v1/carts/checkout` — lines in, one Payment Intent out.
     *
     * @param array $body Cart body: merchant, currency, lines, payment rail.
     * @return array|WP_Error Decoded response with `paymentIntent`.
     */
    public function checkout_cart(array $body) {
        return $this->request('POST', '/v1/carts/checkout', $body);
    }

    /**
     * `POST /v1/payment-intents/{id}/confirm` — locks the price and allocates
     * the deposit address. Takes no body.
     *
     * @return array|WP_Error
     */
    public function confirm_intent(string $intent_id) {
        return $this->request(
            'POST',
            '/v1/payment-intents/' . rawurlencode($intent_id) . '/confirm',
            null
        );
    }

    /**
     * `POST /v1/payments/{id}/refunds` — an omitted amount refunds everything
     * still refundable.
     *
     * @return array|WP_Error Decoded response with `refund`.
     */
    public function refund_payment(string $intent_id, array $body) {
        return $this->request(
            'POST',
            '/v1/payments/' . rawurlencode($intent_id) . '/refunds',
            $body
        );
    }

    /** The hosted payment page for a confirmed intent. */
    public function pay_page_url(string $intent_id): string {
        return $this->base_url . '/checkout/pay/' . rawurlencode($intent_id);
    }

    /**
     * @param array|null $body `null` sends no body.
     * @return array|WP_Error Decoded JSON on 2xx; `WP_Error` otherwise.
     */
    private function request(string $method, string $path, ?array $body) {
        $response = wp_remote_request($this->base_url . $path, [
            'method'  => $method,
            'timeout' => 30,
            'headers' => [
                'Authorization'   => 'Bearer ' . $this->secret_key,
                'Content-Type'    => 'application/json',
                'Mayarin-Version' => MAYARIN_API_VERSION,
                'User-Agent'      => 'mayarin-woocommerce/' . MAYARIN_PLUGIN_VERSION,
            ],
            'body'    => $body === null ? '' : wp_json_encode($body),
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $status  = (int) wp_remote_retrieve_response_code($response);
        $decoded = json_decode(wp_remote_retrieve_body($response), true);

        if ($status >= 200 && $status < 300) {
            return is_array($decoded) ? $decoded : [];
        }

        return new WP_Error(
            'mayarin_api_error',
            mayarin_api_error_message($status, $decoded),
            ['status' => $status]
        );
    }
}

/**
 * One legible sentence out of an API error response.
 *
 * The API's error body is `{ "error": { "code", "message", "retryable" } }`
 * (`apps/api/src/errors.ts`). A version refusal names the pinned version and
 * tells the merchant what to do. Pure; tested without WordPress.
 *
 * @param mixed $decoded Decoded JSON body, or null when the body was not JSON.
 */
function mayarin_api_error_message(int $status, $decoded): string {
    $error = is_array($decoded) && isset($decoded['error']) && is_array($decoded['error'])
        ? $decoded['error']
        : null;

    if ($error === null || !isset($error['code'], $error['message'])) {
        return sprintf('Mayarin API returned HTTP %d.', $status);
    }

    $message = sprintf('Mayarin API error %s: %s', $error['code'], $error['message']);

    if (strpos((string) $error['code'], 'VERSION') !== false) {
        $message .= sprintf(
            ' This plugin targets Mayarin API version %s. Update the Mayarin Payments plugin.',
            MAYARIN_API_VERSION
        );
    }

    return $message;
}
