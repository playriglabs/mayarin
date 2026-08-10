/**
 * Event log route tests — the merchant timeline.
 *
 * The route is a thin read over `EventLogService`, which is a thin read over
 * `MerchantEventRepository`. What matters at the edge: the merchant scope comes
 * from the session and cannot be widened, the three kinds coexist on one
 * timeline ordered newest-first, and a webhook row carries no `intentId` in v1.
 * Severity derivation lives in the Drizzle adapter and is exercised through the
 * database suite; the in-memory fake stores rows verbatim, so these tests check
 * shape and scoping, not mapping.
 */

import { describe, expect, test } from "bun:test";
import type { MerchantEventRow } from "@mayarin/compliance";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

function row(merchantId: string, partial: Omit<MerchantEventRow, "merchantId">): MerchantEventRow {
  return { merchantId, ...partial };
}

async function seed() {
  const harness = await createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
  const res = await harness.request("POST", "/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  const csrf = jar.mayarin_csrf ?? "";

  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const events: MerchantEventRow[] = [
    row(harness.merchantId, {
      kind: "clearing",
      occurredAt: new Date(now),
      intentId: "pmt_a",
      summary: "Clearing SUCCESS",
      severity: "success",
    }),
    row(harness.merchantId, {
      kind: "settlement",
      occurredAt: new Date(now + 60_000),
      intentId: "pmt_a",
      summary: "Settlement confirmed",
      severity: "success",
    }),
    row(harness.merchantId, {
      kind: "webhook",
      occurredAt: new Date(now + 120_000),
      summary: "Webhook delivered",
      severity: "success",
    }),
    // A foreign merchant's event must never appear.
    row("mch_other", {
      kind: "clearing",
      occurredAt: new Date(now + 180_000),
      intentId: "pmt_other",
      summary: "Clearing FAILED",
      severity: "error",
    }),
  ];
  harness.eventLogRepository.add(...events);

  return { harness, jar, csrf };
}

describe("GET /event-logs", () => {
  test("an anonymous request is 401", async () => {
    const { harness } = await seed();
    expect((await harness.request("GET", "/event-logs")).status).toBe(401);
  });

  test("lists the caller's own events, newest-first, across all three kinds", async () => {
    const { harness, jar } = await seed();
    const res = await harness.request("GET", "/event-logs", { cookies: jar });
    expect(res.status).toBe(200);
    const events = res.body?.events ?? [];
    // Three own-merchant rows; the foreign one is absent.
    expect(events).toHaveLength(3);
    // Newest-first: webhook (now+120s) before settlement (now+60s) before clearing (now).
    expect(events[0].kind).toBe("webhook");
    expect(events[1].kind).toBe("settlement");
    expect(events[2].kind).toBe("clearing");
  });

  test("a webhook row carries a null intentId in v1", async () => {
    const { harness, jar } = await seed();
    const res = await harness.request("GET", "/event-logs", { cookies: jar });
    const webhook = (res.body?.events ?? []).find((e: { kind: string }) => e.kind === "webhook");
    expect(webhook?.intentId).toBeNull();
  });

  test("a clearing row links into its payment intent", async () => {
    const { harness, jar } = await seed();
    const res = await harness.request("GET", "/event-logs", { cookies: jar });
    const clearing = (res.body?.events ?? []).find((e: { kind: string }) => e.kind === "clearing");
    expect(clearing?.intentId).toBe("pmt_a");
  });

  test("another merchant's events are never listed", async () => {
    const { harness, jar } = await seed();
    const res = await harness.request("GET", "/event-logs", { cookies: jar });
    const summaries = (res.body?.events ?? []).map((e: { summary: string }) => e.summary);
    expect(summaries).not.toContain("Clearing FAILED");
  });

  test("limit bounds the page", async () => {
    const { harness, jar } = await seed();
    const res = await harness.request("GET", "/event-logs?limit=1", { cookies: jar });
    expect(res.status).toBe(200);
    expect(res.body?.events).toHaveLength(1);
    expect(res.body?.events[0].kind).toBe("webhook");
  });

  test("a bearer key with payments:read reaches the timeline without a session", async () => {
    const { harness, jar, csrf } = await seed();
    const created = await harness.request("POST", "/api-keys", {
      body: { name: "Reader", permissions: ["payments:read"] },
      cookies: jar,
      headers: { "x-csrf-token": csrf },
    });
    const secret = created.body?.secret;

    const res = await harness.request("GET", "/event-logs", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status).toBe(200);
    expect((res.body?.events ?? []).length).toBeGreaterThan(0);
  });
});
