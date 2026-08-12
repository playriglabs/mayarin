<?php
/**
 * Plugin Name: Mayarin Payments
 * Plugin URI: https://github.com/playriglabs/mayarin
 * Description: Accept crypto payments in your store currency. The buyer pays with a supported crypto asset. You settle in a stablecoin.
 * Version: 0.1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * Author: Mayarin
 * License: MIT
 * Text Domain: mayarin-payments
 *
 * The plugin is an API client (#113). It calls only the public Mayarin API.
 * It adds no endpoint and imports nothing from the Mayarin monorepo.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MAYARIN_PLUGIN_VERSION', '0.1.0');

/**
 * The API version this plugin build targets. Every request carries it as
 * `Mayarin-Version`. When the API refuses it, the plugin shows a legible
 * message instead of failing silently.
 */
define('MAYARIN_API_VERSION', '2026-08-11');

define('MAYARIN_PLUGIN_DIR', plugin_dir_path(__FILE__));

require_once MAYARIN_PLUGIN_DIR . 'includes/mayarin-signature.php';
require_once MAYARIN_PLUGIN_DIR . 'includes/mayarin-webhook.php';

add_action('plugins_loaded', 'mayarin_payments_init');

function mayarin_payments_init(): void {
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }

    require_once MAYARIN_PLUGIN_DIR . 'includes/class-mayarin-client.php';
    require_once MAYARIN_PLUGIN_DIR . 'includes/class-mayarin-gateway.php';

    add_filter('woocommerce_payment_gateways', function (array $gateways): array {
        $gateways[] = Mayarin_Gateway::class;
        return $gateways;
    });
}

add_action('rest_api_init', function (): void {
    register_rest_route('mayarin/v1', '/webhook', [
        'methods' => 'POST',
        'callback' => 'mayarin_handle_webhook_request',
        // The HMAC signature is the authentication. The callback verifies it
        // over the raw body before it reads anything else.
        'permission_callback' => '__return_true',
    ]);
});

add_action('before_woocommerce_init', function (): void {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
            'custom_order_tables',
            __FILE__,
            true
        );
    }
});
