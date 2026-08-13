import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import {
  rehypeCode,
  remarkCodeTab,
  remarkHeading,
  remarkNpm,
  remarkStructure,
} from "fumadocs-core/mdx-plugins";
import {
  createFileSystemGeneratorCache,
  createGenerator,
  remarkAutoTypeTable,
} from "fumadocs-typescript";

const typeGenerator = createGenerator({
  cache: createFileSystemGeneratorCache(".astro/fumadocs-typescript"),
});
const renderTypeTableText = async (value) => ({
  type: "root",
  children: [{ type: "text", value }],
});
const deepMergeInteropId = "\0mayarin-fumadocs-deep-merge";
const deepMergeInterop = {
  name: "mayarin-fumadocs-deep-merge-interop",
  enforce: "pre",
  resolveId(id) {
    return id.includes("@fumadocs/api-docs/dist/node_modules/.pnpm/@fastify_deepmerge")
      ? deepMergeInteropId
      : undefined;
  },
  load(id) {
    if (id !== deepMergeInteropId) return undefined;
    return `
      const isMergeable = (value) =>
        typeof value === "object" && value !== null && !Array.isArray(value);
      const merge = (left, right) => {
        if (!isMergeable(left) || !isMergeable(right)) return right;
        return Object.fromEntries(
          [...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => [
            key,
            key in right ? (key in left ? merge(left[key], right[key]) : right[key]) : left[key],
          ]),
        );
      };
      const deepmerge = (options = {}) => (...values) =>
        values.reduce((result, value) => merge(result, value), {});
      const require_deepmerge = () => ({ deepmerge });
      export { require_deepmerge };
      export default { deepmerge };
    `;
  },
};
const remarkPlugins = [
  remarkHeading,
  remarkCodeTab,
  remarkNpm,
  [remarkStructure, { exportAs: "structuredData" }],
  [
    remarkAutoTypeTable,
    {
      generator: typeGenerator,
      renderMarkdown: renderTypeTableText,
      renderType: renderTypeTableText,
    },
  ],
];

export default defineConfig({
  site: "https://docs.mayarin.xyz",
  output: "server",
  adapter: cloudflare({ imageService: "compile" }),
  publicDir: fileURLToPath(new URL("../landing/public", import.meta.url)),
  markdown: {
    syntaxHighlight: false,
    remarkPlugins,
    rehypePlugins: [rehypeCode],
  },
  integrations: [
    react(),
    mdx({
      extendMarkdownConfig: true,
      syntaxHighlight: false,
    }),
  ],
  vite: {
    plugins: [deepMergeInterop, tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    ssr: {
      noExternal: [
        "fumadocs-core",
        "fumadocs-ui",
        "fumadocs-openapi",
        "@fumadocs/api-docs",
        "@fumadocs/base-ui",
      ],
    },
  },
});
