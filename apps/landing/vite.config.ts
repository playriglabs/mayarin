import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { shikiSnippets } from "./plugins/shiki-snippets.ts";

export default defineConfig({
  plugins: [preact(), tailwindcss(), shikiSnippets()],
  server: {
    port: 4321,
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
  build: { target: "es2022" },
});
