/**
 * `GET /fx/currencies`: the currencies a merchant can read their money in.
 *
 * Public, because the register form asks before there is an account. It is
 * reference data and carries no rate.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";

export function fxRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/currencies", async (c) => {
    const rates = await container.displayRates.rates();
    return c.json({ currencies: rates === undefined ? [] : Object.keys(rates).sort() });
  });

  return app;
}
