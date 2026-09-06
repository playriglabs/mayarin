import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// The dashboard API runs on its own port; in dev the Vite proxy rewrites /api/*
// to it so the browser talks to one origin and cookies stay on this host.
const dashboardApiUrl = process.env.DASHBOARD_API_URL ?? "http://localhost:3001";
const localDev = process.env.MAYARIN_DASHBOARD_LOCAL_DEV === "true";

export default defineConfig({
  output: "server",
  // The Cloudflare Vite runner currently crashes during Astro development with
  // `Missing field moduleType` (workers-sdk#15129). Local development uses the
  // Vite API proxy below and no Worker bindings, so keep the production adapter
  // for checks/builds/deploys while Astro's native dev server handles `bun dev`.
  adapter: localDev ? undefined : cloudflare(),
  // `@astrojs/react` forwards an `exclude` to `@vitejs/plugin-react` that
  // replaces plugin-react's default `node_modules` exclude with just `/\.astro$/`.
  // That lets the babel refresh pass run on Vite's prebundled dep chunks, and the
  // React client runtime (react + react-dom, ~820KB unminified in dev) then trips
  // @babel/generator's 500KB "deoptimised the styling" note on every dev start.
  // Re-adding `node_modules` restores plugin-react's intended default — user JSX
  // in `src/` keeps fast refresh, dep chunks are skipped.
  integrations: [react({ exclude: [/\.astro$/, /node_modules/] })],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        // `/api/` (trailing slash), not `/api`: a startsWith match on `/api`
        // would also swallow the `/api-keys` *page* route and proxy it to the
        // dashboard API, where the rewrite mangles it into a 404. Every client
        // call is `/api/v1/<path>`, so `/api/` matches those and leaves the
        // page alone.
        "/api/": {
          target: dashboardApiUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  },
});
