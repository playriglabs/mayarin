/**
 * Builds the npm package. `@mayarin/sdk` and `react` stay imports — the first
 * is a published dependency, the second the host app's own copy.
 */

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  dts: true,
  deps: {
    onlyImport: ["@mayarin/sdk", "react"],
  },
});
