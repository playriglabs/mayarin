=== Mayarin Payments ===
Contributors: mayarin
Tags: payments, crypto, stablecoin, woocommerce
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: MIT

Accept crypto payments in your store currency. The buyer pays with a supported crypto asset. You settle in a stablecoin.

== Description ==

Mayarin Payments adds a payment gateway to WooCommerce. Your prices stay in
your store currency (IDR, USD, SGD, THB or MYR). The buyer pays with crypto on
a hosted payment page. The webhook marks the order paid — a buyer who closes
the tab still gets their order completed.

The plugin is a client of the public Mayarin API. It stores no crypto and
holds no keys other than the API credentials you enter.

== Installation ==

1. Upload the plugin and activate it.
2. Open WooCommerce → Settings → Payments → Mayarin.
3. Enter your secret key and merchant ID from the Mayarin dashboard.
4. In the Mayarin dashboard, register this webhook endpoint:
   `https://your-store/wp-json/mayarin/v1/webhook`
5. Paste the endpoint's signing secret into the gateway settings.

== Frequently Asked Questions ==

= Which currencies does it support? =

IDR, USD, SGD, THB and MYR as the store currency. The buyer pays with the
crypto asset you select in the gateway settings.

= Can I refund from the order screen? =

Yes. Refunds go through the Mayarin API and are capped at what is refundable.

== Changelog ==

= 0.1.0 =
* First release: hosted checkout redirect, webhook-driven order status, refunds.
