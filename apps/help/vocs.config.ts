import { defineConfig } from "vocs/config";

export default defineConfig({
  title: "Mayarin Help Center",
  titleTemplate: "%s — Mayarin Help Center",
  baseUrl: "https://help.mayarin.xyz",
  accentColor: "light-dark(#1f6f54, #0eeb2e)",
  iconUrl: "/favicon-32x32.png",
  ogImageUrl: "/og-image.jpeg",
  head: {
    link: [
      { rel: "icon", href: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { rel: "icon", href: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    meta: {
      author: "Mayarin",
      themeColor: "#ffffff",
      colorScheme: "light dark",
      ogSiteName: "Mayarin",
      ogLocale: "en_US",
      ogImageWidth: 1200,
      ogImageHeight: 630,
      twitterCard: "summary_large_image",
      twitterSite: "@mayarin_xyz",
    },
  },
  description:
    "Set up Mayarin, take your first payment and run your account day to day. Written for merchants.",
  editLink: {
    link: "https://github.com/playriglabs/mayarin/edit/main/apps/help/src/pages/:path",
    text: "Edit this page",
  },
  topNav: [
    { text: "Dashboard", link: "https://dashboard.mayarin.xyz", external: true },
    { text: "Developer docs", link: "https://docs.mayarin.xyz", external: true },
    { text: "Contact", link: "/contact" },
  ],
  sidebar: [
    { text: "Help Center", link: "/" },
    {
      text: "Get started",
      items: [
        { text: "Create your account", link: "/start/create-account" },
        { text: "Set up your wallet", link: "/start/set-up-wallet" },
        { text: "Choose networks and assets", link: "/start/choose-networks" },
        { text: "Take your first payment", link: "/start/first-payment" },
      ],
    },
    {
      text: "Accept payments",
      items: [
        { text: "Payment links", link: "/accept/payment-links" },
        { text: "Invoices", link: "/accept/invoices" },
        { text: "Subscriptions", link: "/accept/subscriptions" },
        { text: "Payment statuses", link: "/accept/payment-statuses" },
      ],
    },
    {
      text: "Connect your store",
      items: [
        { text: "API keys", link: "/integrate/api-keys" },
        { text: "Webhooks", link: "/integrate/webhooks" },
        { text: "WooCommerce", link: "/integrate/woocommerce" },
      ],
    },
    {
      text: "Manage your account",
      items: [
        { text: "Understand settlement", link: "/manage/settlement" },
        { text: "Withdraw and pay out", link: "/manage/withdraw" },
        { text: "Refunds and disputes", link: "/manage/refunds-and-disputes" },
        { text: "Flagged payments", link: "/manage/flagged-payments" },
        { text: "Two-factor authentication", link: "/manage/two-factor" },
      ],
    },
    {
      text: "Troubleshooting",
      items: [
        { text: "A payment is stuck", link: "/troubleshooting/payment-stuck" },
        { text: "Webhooks are not arriving", link: "/troubleshooting/webhook-not-arriving" },
        { text: "FAQ", link: "/troubleshooting/faq" },
      ],
    },
    { text: "Contact support", link: "/contact" },
  ],
});
