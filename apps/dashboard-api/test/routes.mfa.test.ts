/**
 * Authenticator-app second factor (SEC-15, SEC-16): enrolment, the sign-in
 * challenge, and the step-up on routes that move funds.
 */

import { describe, expect, test } from "bun:test";
import { totpCode, totpStepAt } from "@mayarin/auth";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const EMAIL = "admin@mayarin.local";
const PASSWORD = "correct-horse-battery-staple";
/** The harness clock is fixed here, so this is the step the service sees. */
const STEP = totpStepAt(new Date("2026-01-01T00:00:00.000Z"));

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seeded() {
  return createDashboardHarness({ adminEmail: EMAIL, adminPassword: PASSWORD });
}

async function signIn(harness: Harness) {
  const res = await harness.request("POST", "/v1/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  const jar = cookieJar(res.setCookies);
  return { res, jar, csrf: jar.mayarin_csrf ?? "" };
}

function post(
  harness: Harness,
  auth: { jar: Record<string, string>; csrf: string },
  path: string,
  body: unknown,
) {
  return harness.request("POST", path, {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

/** Enrols the account and returns what a person would be holding afterwards. */
async function enrol(harness: Harness) {
  const auth = await signIn(harness);
  const setup = await post(harness, auth, "/v1/auth/mfa/setup", {});
  const secret = setup.body?.secret as string;
  const confirmed = await post(harness, auth, "/v1/auth/mfa/verify", {
    code: totpCode(secret, STEP),
  });
  return { auth, secret, setup, confirmed };
}

describe("other sessions", () => {
  /** `/me` answers 200 either way; a signed-out caller just has no user. */
  async function signedIn(harness: Harness, auth: { jar: Record<string, string> }) {
    const me = await harness.request("GET", "/v1/auth/me", { cookies: auth.jar });
    return me.body?.user !== null;
  }

  test("enabling the second factor signs out every other device, and the current one stays", async () => {
    const harness = await seeded();
    const stolen = await signIn(harness);
    const current = await signIn(harness);
    const setup = await post(harness, current, "/v1/auth/mfa/setup", {});
    const secret = setup.body?.secret as string;

    await post(harness, current, "/v1/auth/mfa/verify", { code: totpCode(secret, STEP) });

    expect(await signedIn(harness, stolen)).toBe(false);
    expect(await signedIn(harness, current)).toBe(true);
  });

  test("a session can sign out every other one on request", async () => {
    const harness = await seeded();
    const other = await signIn(harness);
    const current = await signIn(harness);

    const res = await post(harness, current, "/v1/auth/sessions/revoke-others", {});

    expect(res.status).toBe(200);
    expect(await signedIn(harness, other)).toBe(false);
    expect(await signedIn(harness, current)).toBe(true);
  });
});

describe("enrolment", () => {
  test("setup hands out a scannable secret and enforces nothing until it is confirmed", async () => {
    const harness = await seeded();
    const auth = await signIn(harness);

    const setup = await post(harness, auth, "/v1/auth/mfa/setup", {});

    expect(setup.status).toBe(200);
    expect(setup.body?.otpauthUri).toStartWith("otpauth://totp/Mayarin:");
    expect(setup.body?.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body?.qrSvg).toContain("<svg");

    // Still a password-only account: signing in again issues a session.
    const again = await signIn(harness);
    expect(again.res.status).toBe(200);
    expect(again.res.body?.mfaRequired).toBeUndefined();
    const me = await harness.request("GET", "/v1/auth/me", { cookies: auth.jar });
    expect(me.body?.user.mfaEnabled).toBe(false);
  });

  test("a wrong code does not enable it; the right one does and shows recovery codes once", async () => {
    const harness = await seeded();
    const auth = await signIn(harness);
    const setup = await post(harness, auth, "/v1/auth/mfa/setup", {});
    const secret = setup.body?.secret as string;

    const wrong = await post(harness, auth, "/v1/auth/mfa/verify", { code: "000000" });
    expect(wrong.status).toBe(401);

    const ok = await post(harness, auth, "/v1/auth/mfa/verify", { code: totpCode(secret, STEP) });
    expect(ok.status).toBe(200);
    expect(ok.body?.recoveryCodes).toHaveLength(10);

    const me = await harness.request("GET", "/v1/auth/me", { cookies: auth.jar });
    expect(me.body?.user.mfaEnabled).toBe(true);
  });

  test("an enabled account cannot start setup again without disabling", async () => {
    const harness = await seeded();
    const { auth } = await enrol(harness);

    const again = await post(harness, auth, "/v1/auth/mfa/setup", {});

    expect(again.status).toBe(409);
  });
});

describe("sign-in", () => {
  test("the password alone issues a challenge and no session", async () => {
    const harness = await seeded();
    await enrol(harness);

    const res = await signIn(harness);

    expect(res.res.status).toBe(200);
    expect(res.res.body?.mfaRequired).toBe(true);
    expect(res.res.body?.challenge).toBeString();
    expect(res.res.setCookies).toHaveLength(0);
  });

  test("the code completes it once, and a replayed code does not", async () => {
    const harness = await seeded();
    const { secret } = await enrol(harness);
    const challenge = (await signIn(harness)).res.body?.challenge as string;
    // One step on from the enrolment code, which is spent.
    const code = totpCode(secret, STEP + 1);

    const first = await harness.request("POST", "/v1/auth/login/mfa", {
      body: { challenge, code },
    });
    expect(first.status).toBe(200);
    expect(first.setCookies.some((line) => line.startsWith("mayarin_session="))).toBe(true);

    const replay = await harness.request("POST", "/v1/auth/login/mfa", {
      body: { challenge, code },
    });
    expect(replay.status).toBe(401);
  });

  test("a recovery code signs in once and is then spent", async () => {
    const harness = await seeded();
    const { confirmed } = await enrol(harness);
    const recoveryCodes: string[] = confirmed.body?.recoveryCodes ?? [];
    const recovery = recoveryCodes[0];

    const challenge = (await signIn(harness)).res.body?.challenge as string;
    const first = await harness.request("POST", "/v1/auth/login/mfa", {
      body: { challenge, code: recovery },
    });
    const second = await harness.request("POST", "/v1/auth/login/mfa", {
      body: { challenge, code: recovery },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
  });

  test("a forged or wrong-account challenge is refused", async () => {
    const harness = await seeded();
    const { secret } = await enrol(harness);

    const forged = await harness.request("POST", "/v1/auth/login/mfa", {
      body: {
        challenge: "eyJ1IjoieCIsImUiOjk5OTk5OTk5OTk5OTl9.AAAA",
        code: totpCode(secret, STEP + 1),
      },
    });

    expect(forged.status).toBe(401);
  });
});

describe("step-up on routes that move funds", () => {
  const withdrawal = {
    chain: "base-sepolia",
    asset: "USDC",
    amount: "1000000",
    to: `0x${"ab".repeat(20)}`,
  };

  test("an account with no second factor is told to set one up", async () => {
    const harness = await seeded();
    const auth = await signIn(harness);

    const res = await harness.request("POST", "/v1/wallets/withdraw", {
      body: withdrawal,
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf, "x-mfa-code": "" },
    });

    expect(res.status).toBe(403);
    expect(res.body?.error?.details?.reason ?? res.body?.error?.reason).toBe("mfa_setup_required");
  });

  test("an enrolled account must present a code, and a wrong one is refused", async () => {
    const harness = await seeded();
    const { auth } = await enrol(harness);
    const headers = { "x-csrf-token": auth.csrf };

    const missing = await harness.request("POST", "/v1/wallets/withdraw", {
      body: withdrawal,
      cookies: auth.jar,
      headers: { ...headers, "x-mfa-code": "" },
    });
    const wrong = await harness.request("POST", "/v1/wallets/withdraw", {
      body: withdrawal,
      cookies: auth.jar,
      headers: { ...headers, "x-mfa-code": "000000" },
    });

    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(401);
  });

  test("credential and settlement changes ask for a code too", async () => {
    const harness = await seeded();
    const { auth } = await enrol(harness);
    const headers = { "x-csrf-token": auth.csrf, "x-mfa-code": "" };
    const attempts = [
      harness.request("POST", "/v1/api-keys", {
        body: { name: "k", permissions: ["payments:read"] },
        cookies: auth.jar,
        headers,
      }),
      harness.request("POST", "/v1/webhooks/endpoints", {
        body: { url: "https://merchant.example/hook" },
        cookies: auth.jar,
        headers,
      }),
      harness.request("PATCH", "/v1/settings", {
        body: { city: "Bandung" },
        cookies: auth.jar,
        headers,
      }),
    ];

    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
    }
  });

  test("disabling needs a valid code", async () => {
    const harness = await seeded();
    const { auth, secret } = await enrol(harness);

    const refused = await post(harness, auth, "/v1/auth/mfa/disable", { code: "000000" });
    expect(refused.status).toBe(401);

    const ok = await post(harness, auth, "/v1/auth/mfa/disable", {
      code: totpCode(secret, STEP + 1),
    });
    expect(ok.status).toBe(200);
    const me = await harness.request("GET", "/v1/auth/me", { cookies: auth.jar });
    expect(me.body?.user.mfaEnabled).toBe(false);
  });
});
