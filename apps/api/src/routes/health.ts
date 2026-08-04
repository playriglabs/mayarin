/**
 * Health route.
 *
 * A liveness signal reporting the settlement asset and registered providers.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";

export function healthRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      settlementAsset: container.config.settlementAsset,
      providers: container.adapters.names(),
    }),
  );

  return app;
}
