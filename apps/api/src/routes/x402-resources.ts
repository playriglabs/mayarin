/**
 * The merchant surface for x402 resources (#208).
 *
 * Registration was admin-only, which made it a deployment act: someone with the
 * deployment's token registered a resource on a merchant's behalf. That is the
 * right posture for a shared operator address and the wrong one for a merchant
 * selling their own endpoint, so this route exists beside it — same service,
 * same rules, authenticated by the merchant's own API key.
 *
 * The merchant comes from the key and is never read from the body. A key that
 * could name any merchant would be an admin token wearing a merchant's name.
 */

import { fromDecimalString } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { merchantX402ResourceSchema, toX402ResourceDto } from "../dto/x402-resource.ts";
import { type ApiKeyAuthEnv, requireApiKey } from "../middleware/api-key.ts";
import { requireX402 } from "./x402.ts";

export function x402ResourceRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();
  const read = requireApiKey(container.verifyApiKey);
  const manage = requireApiKey(container.verifyApiKey, "catalog:manage");

  app.get("/", read, async (c) => {
    const service = requireX402(container);
    const resources = await service.listByMerchant(c.get("scope").merchantId);
    return c.json({ resources: resources.map(toX402ResourceDto) });
  });

  app.post("/", manage, async (c) => {
    const service = requireX402(container);
    const body = merchantX402ResourceSchema.parse(await c.req.json());

    const resource = await service.register({
      id: body.id,
      merchantId: c.get("scope").merchantId,
      url: body.url,
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.mimeType === undefined ? {} : { mimeType: body.mimeType }),
      price: fromDecimalString(body.price.amount, body.price.asset),
      accepts: body.accepts,
      maxTimeoutSeconds: body.maxTimeoutSeconds,
    });

    return c.json({ resource: toX402ResourceDto(resource) }, 201);
  });

  return app;
}
