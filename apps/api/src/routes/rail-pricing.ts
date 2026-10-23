/**
 * Whether one rail can be priced, answered by the source checkout itself uses.
 *
 * The dashboard decides which rails a merchant sees as accepted or off. It used
 * to ask `POST /v1/quotes`, which prices one dollar; checkout prices one whole
 * unit of the payer's asset through the pools and drops the rail when that
 * price strays from the reference. The two disagreed, so a rail showed
 * "accepting" in settings and was missing for the payer. Asking the same
 * source, with the same cache, makes settings say what checkout does.
 *
 * Internal only: it spends oracle and RPC calls, and it is the dashboard's
 * question, not a payer's.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import { assetCodeSchema, UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { isInternal } from "../middleware/payer-access.ts";

const bodySchema = z
  .object({
    chain: z.enum(CHAIN_IDS),
    asset: assetCodeSchema,
    settlementAsset: assetCodeSchema,
  })
  .strict();

export function railPricingRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/priceable", async (c) => {
    if (!isInternal(container, c.req.header("x-internal-token"))) {
      throw new UnauthorizedError("This route is for the dashboard API");
    }
    const rail = bodySchema.parse(await c.req.json());
    return c.json({ priceable: await container.railPricing.canPrice(rail) });
  });

  return app;
}
