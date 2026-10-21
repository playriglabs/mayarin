import { defineConfig } from "vocs/config";

export default defineConfig({
  title: "Mayarin Docs",
  titleTemplate: "%s — Mayarin Docs",
  baseUrl: "https://docs.mayarin.xyz",
  accentColor: "light-dark(#2563eb, #60a5fa)",
  iconUrl: "/favicon-32x32.png",
  ogImageUrl: "/og-image.jpeg",
  description:
    "Price in fiat, settle in stablecoins, and let anyone — or anything — pay with the asset they already hold, through one API and TypeScript SDK.",
  topNav: [
    { text: "API Reference", link: "/api-reference" },
    { text: "Dashboard", link: "https://dashboard.mayarin.xyz", external: true },
    { text: "Help Center", link: "https://help.mayarin.xyz", external: true },
  ],
  openapi: [
    {
      spec: "./src/lib/openapi.json",
      path: "/api-reference",
    },
  ],
  sidebar: [
    {
      text: "Introduction",
      items: [{ text: "Build programmable commerce", link: "/" }],
    },
    {
      text: "Getting started",
      items: [
        { text: "Quickstart", link: "/quickstart" },
        {
          text: "Concepts",
          items: [
            { text: "Money", link: "/concepts/money" },
            { text: "Rails", link: "/concepts/rails" },
            { text: "Payment lifecycle", link: "/concepts/payment-lifecycle" },
            { text: "Execution paths", link: "/concepts/execution-paths" },
            { text: "Versioning", link: "/concepts/versioning" },
          ],
        },
      ],
    },
    {
      text: "Build",
      items: [
        {
          text: "Guides",
          items: [
            { text: "API quickstart", link: "/guides/api-quickstart" },
            { text: "Authentication", link: "/guides/authentication" },
            { text: "x402", link: "/guides/x402" },
            { text: "Subscriptions", link: "/guides/subscriptions" },
            { text: "Escrow", link: "/guides/escrow" },
            { text: "Analytics", link: "/guides/analytics" },
            { text: "Disputes", link: "/guides/disputes" },
            { text: "Webhooks", link: "/guides/webhooks" },
            { text: "WooCommerce", link: "/guides/woocommerce" },
          ],
        },
        {
          text: "TypeScript SDK",
          items: [
            { text: "Overview", link: "/sdk/typescript" },
            { text: "Server", link: "/sdk/typescript/server" },
            { text: "Browser", link: "/sdk/typescript/browser" },
            { text: "React", link: "/sdk/typescript/react" },
            { text: "Payments", link: "/sdk/typescript/payments" },
            { text: "Commerce", link: "/sdk/typescript/commerce" },
            { text: "Analytics", link: "/sdk/typescript/analytics" },
            { text: "Disputes", link: "/sdk/typescript/disputes" },
            { text: "Webhooks", link: "/sdk/typescript/webhooks" },
            { text: "x402", link: "/sdk/typescript/x402" },
            { text: "Reference", link: "/sdk/typescript/reference" },
          ],
        },
      ],
    },
    {
      text: "Reference",
      items: [
        { text: "API reference", link: "/api-reference" },
        { text: "Errors", link: "/errors" },
        { text: "Changelog", link: "/changelog" },
      ],
    },
  ],
});
