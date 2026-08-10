/**
 * Product routes (#15).
 *
 * Behind `require-auth` + `requirePermission("catalog:manage")`. No route takes
 * a merchant id: the merchant is the one on the session, and the service refuses
 * to reach outside it.
 *
 * Thin by design: validate input, call an application service, shape a response.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  createProductBodySchema,
  listProductsQuerySchema,
  toProductDto,
  updateProductBodySchema,
} from "../dto/catalog.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

export function catalogRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/products", async (c) => {
    const { active } = listProductsQuerySchema.parse(c.req.query());
    const products = await container.catalog.listProducts(scopeOf(c), active);
    return c.json({ products: products.map(toProductDto) });
  });

  app.post("/products", csrfMiddleware(), async (c) => {
    const body = createProductBodySchema.parse(await c.req.json());
    const product = await container.catalog.createProduct(scopeOf(c), {
      sku: body.sku,
      name: body.name,
      prices: body.prices,
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    });
    return c.json({ product: toProductDto(product) }, 201);
  });

  app.get("/products/:id", async (c) => {
    const product = await container.catalog.getProduct(scopeOf(c), c.req.param("id"));
    return c.json({ product: toProductDto(product) });
  });

  app.patch("/products/:id", csrfMiddleware(), async (c) => {
    const body = updateProductBodySchema.parse(await c.req.json());
    const product = await container.catalog.updateProduct(scopeOf(c), c.req.param("id"), {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.prices === undefined ? {} : { prices: body.prices }),
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    });
    return c.json({ product: toProductDto(product) });
  });

  return app;
}
