/**
 * Escrow disputes (#313): the merchant's answer, the arbiter console's
 * permission, and why a merchant can never hold that permission.
 */

import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import type { EscrowDispute } from "@mayarin/db";
import { FixedClock, generateId } from "@mayarin/shared";
import { DisputeService } from "../src/services/disputes.ts";
import type { PaymentApiClient } from "../src/services/payment-api-client.ts";
import { InMemoryDisputeStore } from "./fixtures/dispute-store.ts";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
const ARBITER = "0x00000000000000000000000000000000000000a1";
const NOW = new Date("2026-10-02T00:00:00.000Z");

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

function dispute(overrides: Partial<EscrowDispute> = {}): EscrowDispute {
  return {
    id: "dsp_1",
    paymentIntentId: "pi_1",
    merchantId: "mrc_1",
    chain: "arbitrum-sepolia",
    factory: "0x545a2c8dd1fc765c61ea5dc2105427be89c24a45",
    payer: "0x000000000000000000000000000000000000cafe",
    payee: "0x000000000000000000000000000000000000beef",
    arbiter: ARBITER,
    releaseAfter: NOW,
    resolveBy: new Date(NOW.getTime() + 7 * 86_400_000),
    status: "open",
    decidedAt: undefined,
    alerted: undefined,
    createdAt: NOW,
    ...overrides,
  };
}

function service(store: InMemoryDisputeStore, arbiter?: string | null) {
  return new DisputeService({
    store,
    paymentApi: {} as PaymentApiClient,
    arbiter: arbiter === null ? undefined : (arbiter ?? ARBITER),
    clock: new FixedClock(NOW),
  });
}

describe("DisputeService (#313)", () => {
  test("the merchant answers a dispute over their own payment", async () => {
    const store = new InMemoryDisputeStore();
    store.disputes.push(dispute());

    const message = await service(store).postMerchantMessage("mrc_1", "pi_1", "  Tracking 123  ");
    expect(message.author).toBe("merchant");
    expect(message.body).toBe("Tracking 123");
  });

  test("another merchant's dispute is not found", async () => {
    const store = new InMemoryDisputeStore();
    store.disputes.push(dispute());

    await expect(service(store).postMerchantMessage("mrc_2", "pi_1", "hi")).rejects.toThrow(
      "This payment has no dispute",
    );
  });

  test("a decided dispute takes no more messages", async () => {
    const store = new InMemoryDisputeStore();
    store.disputes.push(dispute({ status: "released" }));

    await expect(service(store).postMerchantMessage("mrc_1", "pi_1", "late")).rejects.toThrow(
      "already decided",
    );
  });

  test("the queue lists only disputes this deployment's arbiter decides", async () => {
    const store = new InMemoryDisputeStore();
    store.disputes.push(
      dispute(),
      dispute({ id: "dsp_2", arbiter: "0x00000000000000000000000000000000000000b2" }),
    );

    expect((await service(store).queue()).map((d) => d.id)).toEqual(["dsp_1"]);
    expect(await service(store, null).queue()).toEqual([]);
  });

  test("the arbiter cannot post in a dispute another arbiter decides", async () => {
    const store = new InMemoryDisputeStore();
    store.disputes.push(dispute({ arbiter: "0x00000000000000000000000000000000000000b2" }));

    await expect(service(store).postArbiterMessage("dsp_1", "hi")).rejects.toThrow(
      "No such dispute",
    );
  });
});

async function seed(): Promise<Harness> {
  return createDashboardHarness({ adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
}

async function insertUser(harness: Harness, email: string, permissions: readonly Permission[]) {
  const now = harness.clock.now();
  const user: User = {
    id: generateId("usr", now.getTime()),
    email,
    passwordHash: "plain:pw-account",
    merchantId: harness.merchantId,
    permissions: [...permissions],
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await harness.users.insert(user);
}

async function loginAs(harness: Harness, email: string, password: string) {
  const res = await harness.request("POST", "/v1/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

describe("dispute routes (#313)", () => {
  test("a merchant admin cannot reach the arbiter console", async () => {
    const harness = await seed();
    const { jar } = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await harness.request("GET", "/v1/disputes", { cookies: jar });
    expect(res.status).toBe(403);
  });

  test("an account with disputes:arbitrate reaches it", async () => {
    const harness = await seed();
    await insertUser(harness, "arbiter@mayarin.local", ["disputes:arbitrate"]);
    const { jar } = await loginAs(harness, "arbiter@mayarin.local", "pw-account");

    const res = await harness.request("GET", "/v1/disputes", { cookies: jar });
    expect(res.status).toBe(200);
    expect(res.body?.disputes).toEqual([]);
  });

  test("a merchant cannot grant disputes:arbitrate to its own accounts", async () => {
    const harness = await seed();
    const { jar, csrf } = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await harness.request("POST", "/v1/admin/users", {
      cookies: jar,
      headers: { "x-csrf-token": csrf },
      body: { email: "judge@mayarin.local", permissions: ["disputes:arbitrate"] },
    });
    expect(res.status).toBe(400);
  });
});
