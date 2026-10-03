/**
 * Builds the npm package.
 *
 * The workspace packages the SDK leans on (`@mayarin/x402`, `@mayarin/chain`,
 * the API DTOs, ...) are private, so they are bundled into the output — both
 * the JavaScript and the declarations. `onlyImport` is the guard: a published
 * file that still imports a `@mayarin/*` package fails the build instead of
 * failing in a consumer's install.
 */

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    browser: "src/browser.ts",
    "x402-connect": "src/x402-connect.ts",
  },
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  dts: { tsconfig: "tsconfig.build.json", resolver: "tsc" },
  deps: {
    alwaysBundle: [/^@mayarin\//],
    // `node:http` is a type-only import of the connect adapter, which is Node-only.
    onlyImport: ["node:http"],
  },
});
