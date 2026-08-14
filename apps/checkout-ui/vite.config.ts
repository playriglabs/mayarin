import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The buyer-facing pages (#151): hosted checkout and the invoice view.
 *
 * Built as ONE JS chunk and ONE CSS file on purpose. The API ships the bundle
 * inside its own image, so a deploy replaces the hashed assets. A payer holding
 * an old page open must never request another chunk that no longer exists —
 * with a single entry chunk, everything the page will ever run is already in
 * the browser.
 */
export default defineConfig({
  base: "/checkout-ui/",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // One chunk. A dynamic import would silently reintroduce deploy skew.
        inlineDynamicImports: true,
      },
    },
  },
});
