import { fileURLToPath } from "node:url";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// The dashboard API runs on its own port; in dev the Vite proxy rewrites /api/*
// to it so the browser talks to one origin and cookies stay on this host.
const dashboardApiUrl = process.env.DASHBOARD_API_URL ?? "http://localhost:3001";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: dashboardApiUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  },
});
