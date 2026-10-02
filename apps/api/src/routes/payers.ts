/**
 * Payer routes (#314).
 *
 * Open, like the checkout endpoints: a payer connecting a wallet on the hosted
 * page has no key. It answers one bit — whether this wallet may take buyer
 * protection — and never the dispute history behind it.
 */

import { ValidationError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";

export function payerRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/:address/protection", async (c) => {
    const address = c.req.param("address");
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new ValidationError("address must be an EVM address", { address });
    }
    return c.json({ eligible: !(await container.payerStanding.isFlagged(address)) });
  });

  return app;
}
