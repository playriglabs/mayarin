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
  devToolbar: { enabled: false },
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
    // Pre-bundled at startup rather than discovered on the first page that
    // imports them.
    //
    // Vite finds dependencies lazily: a subpath nobody has imported yet is not
    // in the initial scan, so the first page to reach for one triggers a
    // re-optimise and every chunk URL the browser is already holding turns into
    // a 504 `Outdated Optimize Dep` — which lands as "Failed to fetch
    // dynamically imported module" on whichever island was hydrating. Islands
    // make it routine here: nothing is imported until a page that uses it is
    // opened, so each new surface is another mid-session re-optimise.
    //
    // Every Base UI subpath in `src/` is listed, not just the ones seen
    // crashing. A component added later needs its subpath added here, and the
    // symptom if it is forgotten is this same 504 rather than a build error.
    optimizeDeps: {
      include: [
        "@base-ui-components/react/alert-dialog",
        "@base-ui-components/react/checkbox",
        "@base-ui-components/react/combobox",
        "@base-ui-components/react/dialog",
        "@base-ui-components/react/popover",
        "@base-ui-components/react/select",
        "@base-ui-components/react/tabs",
        "@base-ui-components/react/tooltip",
        "recharts",
      ],
    },
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
