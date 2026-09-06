import { describe, expect, test } from "bun:test";
import type { Permission } from "@mayarin/auth";
import type { Money } from "@mayarin/shared";
import type { X402Resource } from "@mayarin/x402";
import { Hono } from "hono";
import type { Container } from "../src/container.ts";
import { errorHandler } from "../src/errors.ts";
import { x402ResourceRoutes } from "../src/routes/x402-resources.ts";
import type { X402Service } from "../src/services/x402.ts";

const MERCHANT = "mrc_owner";
const OTHER = "mrc_someone_else";

function resourceFor(merchantId: string, id = "fx-quote"): X402Resource {
  return {
    id,
    merchantId,
    url: "https://merchant.example/quote",
    price: { amount: 20_000n, asset: "USD" } as Money,
    maxTimeoutSeconds: 60,
    accepts: [
      {
        chain: "arc-testnet",
        asset: "USDC",
        contract: "0x3600000000000000000000000000000000000000",
        payTo: "0x596a7fb9857ca6c008dae1ba8e0e44c0eb38c1f5",
        domain: { name: "USDC", version: "2" },
        transferMethod: "eip3009",
      },
    ],
  };
}

interface Registered {
  readonly merchantIds: string[];
  readonly removed: string[];
}

function appFor(
  permissions: readonly Permission[],
  merchantId = MERCHANT,
): { app: Hono; registered: Registered } {
  const registered: Registered = { merchantIds: [], removed: [] };
  const service = {
    async listByMerchant(id: string) {
      return id === MERCHANT ? [resourceFor(MERCHANT)] : [];
    },
    async register(input: { merchantId: string }) {
      registered.merchantIds.push(input.merchantId);
      return resourceFor(input.merchantId);
    },
    async resourceById(id: string) {
      if (id !== "fx-quote") throw new Error(`unknown resource ${id}`);
      return resourceFor(MERCHANT);
    },
    async remove(id: string) {
      registered.removed.push(id);
    },
  } as unknown as X402Service;

  const container = {
    x402: service,
    async verifyApiKey(secret: string) {
      return secret === "sk_live"
        ? { merchantId, kind: "secret", permissions: new Set(permissions) }
        : null;
    },
  } as unknown as Container;

  const app = new Hono();
  app.onError(errorHandler);
  app.route("/x402/resources", x402ResourceRoutes(container));
  return { app, registered };
}

const body = {
  id: "fx-quote",
  url: "https://merchant.example/quote",
  price: { amount: "0.02", asset: "USD" },
  maxTimeoutSeconds: 60,
  accepts: [
    {
      chain: "arc-testnet",
      asset: "USDC",
      contract: "0x3600000000000000000000000000000000000000",
      payTo: "0x596a7fb9857ca6c008dae1ba8e0e44c0eb38c1f5",
    },
  ],
};

const post = (app: Hono, payload: unknown, key = "sk_live") =>
  app.request("/x402/resources", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

describe("POST /v1/x402/resources", () => {
  test("registers under the key's merchant", async () => {
    const { app, registered } = appFor(["catalog:manage"]);

    const response = await post(app, body);

    expect(response.status).toBe(201);
    expect(registered.merchantIds).toEqual([MERCHANT]);
  });

  // The whole point of this route existing beside the admin one. A body that
  // could name a merchant would make every merchant key an admin token, and the
  // failure would be silent: a resource registered under someone else, paying
  // an address they never chose.
  test("refuses a body that names a merchant at all", async () => {
    const { app, registered } = appFor(["catalog:manage"]);

    const response = await post(app, { ...body, merchantId: OTHER });

    expect(response.status).toBe(400);
    expect(registered.merchantIds).toEqual([]);
  });

  test("requires catalog:manage, not merely a valid key", async () => {
    const { app, registered } = appFor(["payments:read"]);

    const response = await post(app, body);

    expect(response.status).toBe(403);
    expect(registered.merchantIds).toEqual([]);
  });

  test("refuses an unknown key", async () => {
    const { app } = appFor(["catalog:manage"]);

    expect((await post(app, body, "nope")).status).toBe(401);
  });
});

describe("DELETE /v1/x402/resources/:id", () => {
  const remove = (app: Hono, id: string) =>
    app.request(`/x402/resources/${id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer sk_live" },
    });

  test("removes the key's own resource", async () => {
    const { app, registered } = appFor(["catalog:manage"]);

    expect((await remove(app, "fx-quote")).status).toBe(204);
    expect(registered.removed).toEqual(["fx-quote"]);
  });

  // Owned by MERCHANT, and this key is another merchant's: absent, not
  // forbidden, so the caller learns nothing about what exists elsewhere.
  test("reads another merchant's resource as absent", async () => {
    const { app, registered } = appFor(["catalog:manage"], OTHER);

    expect((await remove(app, "fx-quote")).status).toBe(404);
    expect(registered.removed).toEqual([]);
  });

  test("requires catalog:manage", async () => {
    const { app, registered } = appFor(["payments:read"]);

    expect((await remove(app, "fx-quote")).status).toBe(403);
    expect(registered.removed).toEqual([]);
  });
});

describe("GET /v1/x402/resources", () => {
  test("lists the key's own resources", async () => {
    const { app } = appFor(["payments:read"]);

    const response = await app.request("/x402/resources", {
      headers: { authorization: "Bearer sk_live" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resources: [{ id: "fx-quote" }] });
  });

  test("shows a different merchant nothing of this one's", async () => {
    const { app } = appFor(["payments:read"], OTHER);

    const response = await app.request("/x402/resources", {
      headers: { authorization: "Bearer sk_live" },
    });

    expect(await response.json()).toEqual({ resources: [] });
  });
});
