/**
 * Customer routes — the merchant-managed directory.
 *
 * Mounted behind `require-auth` + `requirePermission("catalog:manage")`. The
 * merchant is always the one on the session — no route takes a merchant id, so
 * there is nothing to tamper with. Mutating routes carry `csrfMiddleware`.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  createCustomerBodySchema,
  listQuerySchema,
  toCustomerDto,
  updateCustomerBodySchema,
} from "../dto/customers.ts";
import { optionalMoney } from "../dto/money.ts";
import { toOrderDto } from "../dto/orders.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

export function customerRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/", async (c) => {
    const query = listQuerySchema.parse(c.req.query());
    const customers = await container.customers.list(scopeOf(c), {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });
    return c.json({ customers: customers.map(toCustomerDto) });
  });

  app.get("/:id", async (c) => {
    const { customer, orders, lifetimeValue } = await container.customers.detail(
      scopeOf(c),
      c.req.param("id"),
    );
    return c.json({
      customer: toCustomerDto(customer),
      lifetimeValue: optionalMoney(lifetimeValue ?? undefined) ?? null,
      orders: orders.map(toOrderDto),
    });
  });

  app.post("/", csrfMiddleware(), async (c) => {
    const body = createCustomerBodySchema.parse(await c.req.json());
    const customer = await container.customers.create(scopeOf(c), {
      name: body.name,
      ...(body.email === undefined ? {} : { email: body.email }),
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    });
    return c.json({ customer: toCustomerDto(customer) }, 201);
  });

  app.patch("/:id", csrfMiddleware(), async (c) => {
    const body = updateCustomerBodySchema.parse(await c.req.json());
    const customer = await container.customers.update(scopeOf(c), c.req.param("id"), {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.email === undefined ? {} : { email: body.email }),
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    });
    return c.json({ customer: toCustomerDto(customer) });
  });

  app.delete("/:id", csrfMiddleware(), async (c) => {
    await container.customers.delete(scopeOf(c), c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
