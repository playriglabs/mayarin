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

import { fromDecimalString, NotFoundError } from "@mayarin/shared";
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
      // Omitted means unchanged: re-registering a resource must not silently
      // unlist it (#273).
      ...(body.listed === undefined ? {} : { listed: body.listed }),
    });

    return c.json({ resource: toX402ResourceDto(resource) }, 201);
  });

  /**
   * Withdraws a resource this merchant owns.
   *
   * Nothing paid is undone: the ledger and the intents are the record of that,
   * and neither is touched. What stops is the `402` — the price is no longer
   * offered, so it is no longer quotable.
   */
  app.delete("/:id", manage, async (c) => {
    const service = requireX402(container);
    const id = c.req.param("id");
    const resource = await service.resourceById(id).catch(() => undefined);
    if (resource === undefined || resource.merchantId !== c.get("scope").merchantId) {
      throw new NotFoundError(`Resource ${id} not found`, { id });
    }
    await service.remove(id);
    return c.body(null, 204);
  });

  /**
   * The discovery opt-in, same shape as the one on invoices and links (#273):
   * a listed resource appears in the public cross-merchant index, an unlisted
   * one stops appearing. `manage` scope, and a foreign resource answers 404 —
   * the id was not the caller's to know.
   */
  app.post("/:id/list", manage, async (c) => {
    const service = requireX402(container);
    const id = c.req.param("id");
    const resource = await service.resourceById(id).catch(() => undefined);
    if (resource === undefined || resource.merchantId !== c.get("scope").merchantId) {
      throw new NotFoundError(`Resource ${id} not found`, { id });
    }
    return c.json({ resource: toX402ResourceDto(await service.listResource(id)) });
  });

  app.post("/:id/unlist", manage, async (c) => {
    const service = requireX402(container);
    const id = c.req.param("id");
    const resource = await service.resourceById(id).catch(() => undefined);
    if (resource === undefined || resource.merchantId !== c.get("scope").merchantId) {
      throw new NotFoundError(`Resource ${id} not found`, { id });
    }
    return c.json({ resource: toX402ResourceDto(await service.unlistResource(id)) });
  });

  return app;
}
