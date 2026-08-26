<?php
/**
 * The WooCommerce payment gateway.
 *
 * `process_payment` mints a Payment Intent from the order total, confirms it
 * (locks the price, allocates the deposit address), and redirects the buyer
 * to the hosted payment page — the same mint→confirm pair the embed sends.
 * The webhook receiver marks the order paid; the buyer returning does not.
 *
 * Prices stay in the store's own currency. The crypto leg never appears in
 * the merchant's admin.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Mayarin_Gateway extends WC_Payment_Gateway {

    /** Fiat currencies the Mayarin API prices (`packages/shared/src/asset.ts`). */
    private const SUPPORTED_CURRENCIES = ['IDR', 'USD', 'SGD', 'THB', 'MYR'];

    /** Crypto rails the buyer can pay on. */
    private const PAYMENT_ASSETS = ['USDC', 'USDT', 'ETH'];
    private const PAYMENT_CHAINS = ['base', 'base-sepolia'];

    public function __construct() {
        $this->id                 = 'mayarin';
        $this->method_title       = __('Mayarin', 'mayarin-payments');
        $this->method_description = __(
            'The buyer pays with crypto. You receive your store currency. Register the webhook URL in the Mayarin dashboard so orders are marked paid.',
            'mayarin-payments'
        );
        $this->has_fields = false;
        $this->supports   = ['products', 'refunds'];

        $this->init_form_fields();
        $this->init_settings();

        $this->title       = $this->get_option('title');
        $this->description = $this->get_option('description');

        add_action(
            'woocommerce_update_options_payment_gateways_' . $this->id,
            [$this, 'process_admin_options']
        );
    }

    public function init_form_fields(): void {
        $webhook_url = rest_url('mayarin/v1/webhook');

        $this->form_fields = [
            'enabled' => [
                'title'   => __('Enable/Disable', 'mayarin-payments'),
                'type'    => 'checkbox',
                'label'   => __('Enable Mayarin Payments', 'mayarin-payments'),
                'default' => 'no',
            ],
            'title' => [
                'title'       => __('Title', 'mayarin-payments'),
                'type'        => 'text',
                'description' => __('The payment method name the buyer sees at checkout.', 'mayarin-payments'),
                'default'     => __('Pay with crypto', 'mayarin-payments'),
                'desc_tip'    => true,
            ],
            'description' => [
                'title'       => __('Description', 'mayarin-payments'),
                'type'        => 'textarea',
                'description' => __('The payment method description the buyer sees at checkout.', 'mayarin-payments'),
                'default'     => __('Pay with crypto. The store receives its own currency.', 'mayarin-payments'),
                'desc_tip'    => true,
            ],
            'api_base_url' => [
                'title'       => __('API base URL', 'mayarin-payments'),
                'type'        => 'text',
                'description' => __('The origin of the Mayarin payment API.', 'mayarin-payments'),
                'default'     => 'https://api.mayarin.xyz',
            ],
            'secret_key' => [
                'title'       => __('Secret key', 'mayarin-payments'),
                'type'        => 'password',
                'description' => __('Your sk_ API key from the Mayarin dashboard. It stays on this server.', 'mayarin-payments'),
                'default'     => '',
            ],
            'merchant_id' => [
                'title'       => __('Merchant ID', 'mayarin-payments'),
                'type'        => 'text',
                'description' => __('Your merchant id from the Mayarin dashboard.', 'mayarin-payments'),
                'default'     => '',
            ],
            'webhook_secret' => [
                'title'       => __('Webhook signing secret', 'mayarin-payments'),
                'type'        => 'password',
                /* translators: %s: the webhook URL to register. */
                'description' => sprintf(
                    __('Register this URL as a webhook endpoint in the Mayarin dashboard, then paste its signing secret here: %s', 'mayarin-payments'),
                    '<code>' . esc_html($webhook_url) . '</code>'
                ),
                'default'     => '',
            ],
            'payment_asset' => [
                'title'       => __('Payment asset', 'mayarin-payments'),
                'type'        => 'select',
                'description' => __('The crypto asset the buyer pays with. The hosted payment page shows one rail per order.', 'mayarin-payments'),
                'default'     => 'USDC',
                'options'     => array_combine(self::PAYMENT_ASSETS, self::PAYMENT_ASSETS),
            ],
            'payment_chain' => [
                'title'   => __('Payment chain', 'mayarin-payments'),
                'type'    => 'select',
                'default' => 'base',
                'options' => array_combine(self::PAYMENT_CHAINS, self::PAYMENT_CHAINS),
            ],
        ];
    }

    /** Hide the gateway until it is configured; a half-wired checkout must not render. */
    public function is_available(): bool {
        if (!parent::is_available()) {
            return false;
        }
        if ($this->get_option('secret_key') === '' || $this->get_option('merchant_id') === '') {
            return false;
        }
        return in_array(get_woocommerce_currency(), self::SUPPORTED_CURRENCIES, true);
    }

    public function needs_setup(): bool {
        return $this->get_option('secret_key') === '' || $this->get_option('merchant_id') === '';
    }

    /**
     * @param int $order_id
     * @return array
     */
    public function process_payment($order_id) {
        $order = wc_get_order($order_id);
        if (!$order) {
            return ['result' => 'failure'];
        }

        $currency = $order->get_currency();
        if (!in_array($currency, self::SUPPORTED_CURRENCIES, true)) {
            /* translators: %s: the store currency code. */
            wc_add_notice(sprintf(__('Mayarin does not support payments in %s.', 'mayarin-payments'), $currency), 'error');
            return ['result' => 'failure'];
        }

        $merchant = $this->merchant_snapshot();
        if (is_wp_error($merchant)) {
            wc_add_notice($merchant->get_error_message(), 'error');
            return ['result' => 'failure'];
        }

        $client = $this->client();

        // One line for the whole order: the total already carries shipping,
        // taxes and discounts, and a single line cannot drift from it.
        $minted = $client->checkout_cart([
            'merchant' => $merchant,
            'currency' => $currency,
            'lines'    => [[
                /* translators: %s: the order number. */
                'name'      => sprintf(__('Order %s', 'mayarin-payments'), $order->get_order_number()),
                'unitPrice' => ['amount' => (string) $order->get_total(), 'asset' => $currency],
                'quantity'  => 1,
            ]],
            // The hosted payment page has no asset picker, so the rail is
            // chosen here, from the gateway settings.
            'payment' => [
                'asset' => $this->get_option('payment_asset'),
                'chain' => $this->get_option('payment_chain'),
            ],
            'executionPath'     => 'deposit-match',
            'merchantReference' => (string) $order->get_id(),
            // The webhook receiver matches the delivery back to the order
            // through this metadata.
            'metadata' => [
                'wc_order_id'  => (string) $order->get_id(),
                'wc_order_key' => $order->get_order_key(),
            ],
        ]);
        if (is_wp_error($minted)) {
            return $this->fail_payment($order, $minted);
        }

        $intent_id = isset($minted['paymentIntent']['id']) ? (string) $minted['paymentIntent']['id'] : '';
        if ($intent_id === '') {
            return $this->fail_payment(
                $order,
                new WP_Error('mayarin_bad_response', __('The Mayarin API response carried no payment intent id.', 'mayarin-payments'))
            );
        }

        $confirmed = $client->confirm_intent($intent_id);
        if (is_wp_error($confirmed)) {
            return $this->fail_payment($order, $confirmed);
        }

        $order->update_meta_data('_mayarin_payment_intent_id', $intent_id);
        $order->update_meta_data('_mayarin_webhook_sequence', 0);
        /* translators: %s: the payment intent id. */
        $order->update_status('pending', sprintf(__('Mayarin payment intent %s awaits the buyer\'s deposit.', 'mayarin-payments'), $intent_id));
        $order->save();

        if (isset(WC()->cart)) {
            WC()->cart->empty_cart();
        }

        return [
            'result'   => 'success',
            'redirect' => $client->pay_page_url($intent_id),
        ];
    }

    /**
     * Refund through `POST /v1/payments/{id}/refunds`. Who may sign a refund
     * tightens when #12 lands; until then any valid key refunds.
     *
     * @param int        $order_id
     * @param float|null $amount
     * @param string     $reason
     * @return bool|WP_Error
     */
    public function process_refund($order_id, $amount = null, $reason = '') {
        $order = wc_get_order($order_id);
        if (!$order) {
            return new WP_Error('mayarin_no_order', __('Order not found.', 'mayarin-payments'));
        }

        $intent_id = (string) $order->get_meta('_mayarin_payment_intent_id');
        if ($intent_id === '') {
            return new WP_Error('mayarin_no_intent', __('This order carries no Mayarin payment to refund.', 'mayarin-payments'));
        }

        $body = [];
        if ($amount !== null) {
            $body['amount'] = [
                'amount' => (string) wc_format_decimal($amount, wc_get_price_decimals()),
                'asset'  => $order->get_currency(),
            ];
        }
        if ($reason !== '') {
            $body['reason'] = $reason;
        }

        $result = $this->client()->refund_payment($intent_id, $body);
        if (is_wp_error($result)) {
            return $result;
        }

        $refund_id = isset($result['refund']['id']) ? (string) $result['refund']['id'] : '';
        /* translators: %s: the refund id. */
        $order->add_order_note(sprintf(__('Mayarin refund %s issued.', 'mayarin-payments'), $refund_id));
        return true;
    }

    private function client(): Mayarin_Client {
        return new Mayarin_Client(
            (string) $this->get_option('api_base_url'),
            (string) $this->get_option('secret_key')
        );
    }

    /**
     * The merchant snapshot the API requires on a cart checkout. The id comes
     * from the gateway settings; the rest comes from the store's own settings,
     * so the merchant configures nothing twice.
     *
     * @return array|WP_Error
     */
    private function merchant_snapshot() {
        $id = trim((string) $this->get_option('merchant_id'));
        if ($id === '') {
            return new WP_Error('mayarin_no_merchant', __('Set your Mayarin merchant ID in the gateway settings.', 'mayarin-payments'));
        }

        $name = trim((string) get_bloginfo('name'));
        if ($name === '') {
            return new WP_Error('mayarin_no_store_name', __('Set your site title in Settings → General.', 'mayarin-payments'));
        }

        $city = trim((string) get_option('woocommerce_store_city'));
        if ($city === '') {
            return new WP_Error('mayarin_no_city', __('Set your store city in WooCommerce → Settings → General.', 'mayarin-payments'));
        }

        $country_setting = (string) get_option('woocommerce_default_country');
        $country         = strtoupper(explode(':', $country_setting, 2)[0]);
        if (strlen($country) !== 2) {
            return new WP_Error('mayarin_no_country', __('Set your store country in WooCommerce → Settings → General.', 'mayarin-payments'));
        }

        return [
            'id'          => $id,
            'name'        => $name,
            'city'        => $city,
            'countryCode' => $country,
        ];
    }

    /** @return array The failure shape `process_payment` must return. */
    private function fail_payment(WC_Order $order, WP_Error $error): array {
        $order->add_order_note($error->get_error_message());
        wc_add_notice(__('The payment could not be started. Try again or pick another payment method.', 'mayarin-payments'), 'error');
        return ['result' => 'failure'];
    }
}
