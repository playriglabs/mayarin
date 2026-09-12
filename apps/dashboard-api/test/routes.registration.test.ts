/**
 * Self-registration, the verification code, and the login gate in front of it.
 *
 * The interesting assertions are the ones about what the endpoints refuse to
 * say: a registered address and an unregistered one must be indistinguishable
 * to anyone holding only the HTTP response.
 */

import { describe, expect, test } from "bun:test";
import { createDashboardHarness } from "./harness.ts";

const EMAIL = "founder@parahyangan.test";
const PASSWORD = "correct-horse-battery-staple";
const MERCHANT = "Parahyangan Supply";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function register(harness: Harness, overrides: Record<string, unknown> = {}) {
  return harness.request("POST", "/v1/auth/register", {
    body: { email: EMAIL, password: PASSWORD, merchantName: MERCHANT, ...overrides },
  });
}

/** The code the fake sender captured, which is the only place it exists in plaintext. */
function lastCode(harness: Harness): string {
  const sent = harness.verificationEmails.at(-1);
  expect(sent).toBeDefined();
  return sent?.code ?? "";
}

describe("self-registration", () => {
  test("creates the merchant and emails a six-digit code, but no usable login yet", async () => {
    const harness = await createDashboardHarness();

    const res = await register(harness);
    expect(res.status).toBe(202);

    expect(harness.verificationEmails).toHaveLength(1);
    expect(harness.verificationEmails[0]?.email).toBe(EMAIL);
    expect(lastCode(harness)).toMatch(/^\d{6}$/);

    // The account exists, in its own merchant, and is not yet verified.
    const user = await harness.users.findByEmail(EMAIL);
    expect(user?.merchantId).toMatch(/^mrc_/);
    expect(user?.emailVerifiedAt).toBeUndefined();

    const merchant = await harness.merchants.findById(user?.merchantId ?? "");
    expect(merchant?.name).toBe(MERCHANT);
    // Nothing about a chain is decided at signup. The settlement address is
    // pasted in Settings, which is why it must be absent here.
    expect(merchant?.settlementAddress).toBeUndefined();

    const login = await harness.request("POST", "/v1/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(login.status).toBe(401);
    expect(login.setCookies).toHaveLength(0);
  });

  test("the code turns the account into a login", async () => {
    const harness = await createDashboardHarness();
    await register(harness);

    const verify = await harness.request("POST", "/v1/auth/verify-email", {
      body: { email: EMAIL, code: lastCode(harness) },
    });
    expect(verify.status).toBe(200);

    const login = await harness.request("POST", "/v1/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(login.body?.user.email).toBe(EMAIL);
  });

  test("a wrong code is refused, and the account stays locked out", async () => {
    const harness = await createDashboardHarness();
    await register(harness);

    const wrong = String((Number(lastCode(harness)) + 1) % 1_000_000).padStart(6, "0");
    const verify = await harness.request("POST", "/v1/auth/verify-email", {
      body: { email: EMAIL, code: wrong },
    });
    expect(verify.status).toBe(400);

    const login = await harness.request("POST", "/v1/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(login.status).toBe(401);
  });

  test("a code dies after five wrong guesses, even though it has not expired", async () => {
    // Driven through the service rather than HTTP: the route's own rate limit
    // refuses the sixth request before the attempt cap is ever reached, which
    // is the right behaviour on the wire and the wrong test for this rule. Both
    // bounds exist because the limiter is per client and the cap is per code.
    const harness = await createDashboardHarness();
    await register(harness);
    const code = lastCode(harness);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        harness.container.registrations.verify({ email: EMAIL, code: wrong }),
      ).rejects.toThrow(/not valid/);
    }

    // The right code, now worthless.
    await expect(harness.container.registrations.verify({ email: EMAIL, code })).rejects.toThrow(
      /not valid/,
    );

    const user = await harness.users.findByEmail(EMAIL);
    expect(user?.emailVerifiedAt).toBeUndefined();
  });

  test("resending supersedes the previous code rather than adding a second live one", async () => {
    const harness = await createDashboardHarness();
    await register(harness);
    const first = lastCode(harness);

    const resend = await harness.request("POST", "/v1/auth/resend-verification", {
      body: { email: EMAIL },
    });
    expect(resend.status).toBe(202);
    const second = lastCode(harness);
    expect(harness.verificationEmails).toHaveLength(2);

    const stale = await harness.request("POST", "/v1/auth/verify-email", {
      body: { email: EMAIL, code: first },
    });
    expect(stale.status).toBe(400);

    const fresh = await harness.request("POST", "/v1/auth/verify-email", {
      body: { email: EMAIL, code: second },
    });
    expect(fresh.status).toBe(200);
  });

  test("says nothing about whether an address is already registered", async () => {
    // The response to a second signup for a verified account, and to a signup
    // for an address nobody has ever used, must be the same bytes — otherwise
    // the endpoint is a membership oracle for any address somebody tries.
    const harness = await createDashboardHarness();
    await register(harness);
    await harness.request("POST", "/v1/auth/verify-email", {
      body: { email: EMAIL, code: lastCode(harness) },
    });
    const sentSoFar = harness.verificationEmails.length;

    const again = await register(harness);
    const stranger = await register(harness, { email: "nobody@example.test" });

    expect(again.status).toBe(stranger.status);
    expect(again.body).toEqual(stranger.body);
    // And the verified account is not spammed with a code it did not ask for.
    expect(harness.verificationEmails).toHaveLength(sentSoFar + 1);
    expect(harness.verificationEmails.at(-1)?.email).toBe("nobody@example.test");
  });

  test("refuses a password too short to be worth hashing", async () => {
    const harness = await createDashboardHarness();
    const res = await register(harness, { password: "short" });
    expect(res.status).toBe(400);
    expect(harness.verificationEmails).toHaveLength(0);
  });

  test("an operator-seeded account is born verified and signs in without a code", async () => {
    const harness = await createDashboardHarness({
      adminEmail: "admin@mayarin.local",
      adminPassword: PASSWORD,
    });

    const login = await harness.request("POST", "/v1/auth/login", {
      body: { email: "admin@mayarin.local", password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(harness.verificationEmails).toHaveLength(0);
  });
});
