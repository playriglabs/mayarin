import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { shikiSnippets } from "./plugins/shiki-snippets.ts";

export default defineConfig({
  site: "https://mayarin.xyz",
  integrations: [preact(), sitemap()],
  vite: {
    plugins: [tailwindcss(), shikiSnippets()],
    server: {
      // `wrangler pages dev` serves the Functions on 8788 in development.
      proxy: { "/api": "http://127.0.0.1:8788" },
    },
  },
  // `/brand-kit`, not `/brand-kit/`: Cloudflare Pages serves the file at the bare path.
  trailingSlash: "never",
  build: { format: "file" },
});
