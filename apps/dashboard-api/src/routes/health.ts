/**
 * Health route.
 *
 * Liveness only — process up. A `/ready` that probes the database belongs to the
 * scaling plan, not the skeleton.
 */

import { Hono } from "hono";

export function healthRoutes(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: "dashboard-api" }));

  return app;
}
