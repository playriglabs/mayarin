import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { demoApi, loadDemoConfig } from "./server/index.ts";

/**
 * Mounts the thin server (#137) inside the Vite dev server. Vite exposes only
 * `VITE_`-prefixed variables to the browser, so `MAYARIN_SECRET_KEY` read here
 * never reaches the bundle — `verify-bundle.ts` checks that claim on `build`.
 */
function demoServer(): Plugin {
  return {
    name: "mayarin-demo-api",
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, "");
      const config = loadDemoConfig({ ...process.env, ...env });
      server.middlewares.use("/api", demoApi(config));
    },
  };
}

export default defineConfig({
  plugins: [react(), demoServer()],
});
