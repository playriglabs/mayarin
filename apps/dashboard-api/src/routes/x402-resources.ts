/**
 * x402 resource routes (#208).
 *
 * Behind `require-auth` + `requirePermission("catalog:manage")`: a resource is
 * something the merchant sells, priced like a product. No route takes a
 * merchant id — the merchant is the one on the session — and no route takes an
 * address. `GET /rails` says where this merchant can be paid, and creation
 * chooses from that list by chain, so the payout address is never typed.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import { assetCodeSchema, fromDecimalString, UnauthorizedError } from "@mayarin/shared";
import type { X402Resource } from "@mayarin/x402";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toMoneyDto } from "../dto/money.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

const createBodySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      // The id reaches a payer inside a `402` and lives in a URL, so it is
      // spelled like a slug rather than sanitised later.
      .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and hyphens"),
    url: z.string().url(),
    description: z.string().min(1).max(200).optional(),
    mimeType: z.string().min(1).max(100).optional(),
    price: z.object({ amount: z.string().min(1), asset: assetCodeSchema }),
    maxTimeoutSeconds: z.number().int().positive().max(3_600),
    rails: z.array(z.object({ chain: z.enum(CHAIN_IDS), asset: assetCodeSchema }).strict()).min(1),
  })
  .strict();

/** An edit takes everything creation does except the id, which never moves. */
const updateBodySchema = createBodySchema.omit({ id: true });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().min(1).optional(),
});

function toResourceDto(resource: X402Resource): Record<string, unknown> {
  return {
    id: resource.id,
    url: resource.url,
    ...(resource.description === undefined ? {} : { description: resource.description }),
    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
    price: toMoneyDto(resource.price),
    maxTimeoutSeconds: resource.maxTimeoutSeconds,
    accepts: resource.accepts.map((accept) => ({
      chain: accept.chain,
      asset: accept.asset,
      contract: accept.contract,
      payTo: accept.payTo,
      transferMethod: accept.transferMethod,
      domain: accept.domain,
    })),
  };
}

export function x402ResourceRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/", async (c) => {
    const query = listQuerySchema.parse(c.req.query());
    const page = await container.x402Resources.list(scopeOf(c), {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return c.json({
      resources: page.items.map(toResourceDto),
      nextCursor: page.nextCursor,
    });
  });

  /** Where this merchant can be paid today. An empty list is the answer too. */
  app.get("/rails", async (c) => {
    const rails = await container.x402Resources.rails(scopeOf(c));
    return c.json({ rails });
  });

  app.post("/", csrfMiddleware(), async (c) => {
    const body = createBodySchema.parse(await c.req.json());
    const resource = await container.x402Resources.create(scopeOf(c), {
      id: body.id,
      url: body.url,
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.mimeType === undefined ? {} : { mimeType: body.mimeType }),
      price: fromDecimalString(body.price.amount, body.price.asset),
      maxTimeoutSeconds: body.maxTimeoutSeconds,
      rails: body.rails,
    });
    return c.json({ resource: toResourceDto(resource) }, 201);
  });

  /**
   * Edits an endpoint in place.
   *
   * `PUT` rather than `PATCH`, and the whole resource rather than a diff: the
   * rails are rebuilt from the merchant's current options every time, so a
   * partial update would have to guess whether an omitted `rails` meant "leave
   * them" or "remove them". The form always knows all of it.
   */
  app.put("/:id", csrfMiddleware(), async (c) => {
    const body = updateBodySchema.parse(await c.req.json());
    const resource = await container.x402Resources.update(scopeOf(c), c.req.param("id"), {
      url: body.url,
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.mimeType === undefined ? {} : { mimeType: body.mimeType }),
      price: fromDecimalString(body.price.amount, body.price.asset),
      maxTimeoutSeconds: body.maxTimeoutSeconds,
      rails: body.rails,
    });
    return c.json({ resource: toResourceDto(resource) });
  });

  app.delete("/:id", csrfMiddleware(), async (c) => {
    await container.x402Resources.remove(scopeOf(c), c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
