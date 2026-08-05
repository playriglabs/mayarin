import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Served at mayarin.xyz/blog — base prefixes every route + asset URL so the
// blog resolves under the path even though it is a separate app from landing.
export default defineConfig({
  base: "/blog",
  site: "https://mayarin.xyz",
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
  },
  markdown: {
    // Mirror landing's `mayarin` Shiki theme (ink/white/accent green) so blog
    // code blocks read as part of the same site. Values copied from
    // apps/landing/plugins/shiki-snippets.ts — not imported cross-app.
    shikiConfig: {
      // Astro's dual-theme form requires a `light` defaultColor key; map both
      // light/dark to the same `mayarin` theme so the single palette applies.
      themes: {
        light: "mayarin",
        dark: "mayarin",
        mayarin: {
          name: "mayarin",
          type: "dark",
          colors: {
            "editor.background": "#00000000",
            "editor.foreground": "#c9c9c9",
          },
          tokenColors: [
            {
              scope: ["comment", "punctuation.definition.comment"],
              settings: { foreground: "#5c5c5c", fontStyle: "italic" },
            },
            {
              scope: ["string", "string.quoted", "constant.other.symbol"],
              settings: { foreground: "#0eeb2e" },
            },
            {
              scope: ["constant.numeric", "constant.language"],
              settings: { foreground: "#e6e6e6" },
            },
            {
              scope: [
                "keyword",
                "storage",
                "storage.type",
                "keyword.control",
                "keyword.operator.new",
              ],
              settings: { foreground: "#ffffff" },
            },
            {
              scope: ["entity.name.function", "support.function", "meta.function-call"],
              settings: { foreground: "#e6e6e6" },
            },
            {
              scope: ["variable", "meta.definition.variable", "support.variable"],
              settings: { foreground: "#c9c9c9" },
            },
            {
              scope: ["entity.name.type", "support.type", "support.class"],
              settings: { foreground: "#dcdcdc" },
            },
            {
              scope: ["meta.object-literal.key", "variable.object.property"],
              settings: { foreground: "#b4b4b4" },
            },
            {
              scope: ["punctuation", "meta.brace", "keyword.operator"],
              settings: { foreground: "#8a8a8a" },
            },
          ],
        },
      },
    },
  },
});
