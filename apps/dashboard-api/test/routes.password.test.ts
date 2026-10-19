/**
 * Password change and reset (SEC-15): what each path demands, and that a
 * changed password ends the sessions that knew the old one.
 */

import { describe, expect, test } from "bun:test";
import { totpCode, totpStepAt } from "@mayarin/auth";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const EMAIL = "admin@mayarin.local";
const PASSWORD = "correct-horse-battery-staple";
const NEXT = "a-brand-new-long-passphrase";
const STEP = totpStepAt(new Date("2026-01-01T00:00:00.000Z"));

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

const seeded = () => createDashboardHarness({ adminEmail: EMAIL, adminPassword: PASSWORD });

async function signIn(harness: Harness, password = PASSWORD) {
  const res = await harness.request("POST", "/v1/auth/login", {
    body: { email: EMAIL, password },
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

async function signedIn(harness: Harness, auth: { jar: Record<string, string> }) {
  const me = await harness.request("GET", "/v1/auth/me", { cookies: auth.jar });
  return me.body?.user !== null;
}

async function enrol(harness: Harness, auth: Awaited<ReturnType<typeof signIn>>) {
  const setup = await post(harness, auth, "/v1/auth/mfa/setup", {});
  const secret = setup.body?.secret as string;
  await post(harness, auth, "/v1/auth/mfa/verify", { code: totpCode(secret, STEP) });
  return secret;
}

describe("change password", () => {
  test("needs the current password", async () => {
    const harness = await seeded();
    const auth = await signIn(harness);
    const res = await post(harness, auth, "/v1/auth/password/change", {
      currentPassword: "not-the-password",
      newPassword: NEXT,
    });
    expect(res.status).toBe(401);
    expect((await signIn(harness)).res.status).toBe(200);
  });

  test("refuses a short new password", async () => {
    const harness = await seeded();
    const auth = await signIn(harness);
    const res = await post(harness, auth, "/v1/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: "short",
    });
    expect(res.status).toBe(400);
  });

  test("swaps the password and signs out the other devices, not this one", async () => {
    const harness = await seeded();
    const here = await signIn(harness);
    const elsewhere = await signIn(harness);

    const res = await post(harness, here, "/v1/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: NEXT,
    });
    expect(res.status).toBe(200);

    expect(await signedIn(harness, here)).toBe(true);
    expect(await signedIn(harness, elsewhere)).toBe(false);
    expect((await signIn(harness, PASSWORD)).res.status).toBe(401);
    expect((await signIn(harness, NEXT)).res.status).toBe(200);
  });

  test("an account with a second factor must present a code", async () => {
    const harness = await seeded();
    const auth = await signIn(harness);
    const secret = await enrol(harness, auth);

    const without = await post(harness, auth, "/v1/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: NEXT,
    });
    expect(without.status).toBe(403);

    const wrong = await post(harness, auth, "/v1/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: NEXT,
      code: "000000",
    });
    expect(wrong.status).toBe(401);

    const ok = await post(harness, auth, "/v1/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: NEXT,
      code: totpCode(secret, STEP + 1),
    });
    expect(ok.status).toBe(200);
  });
});

describe("reset password", () => {
  const forgot = (harness: Harness, email = EMAIL) =>
    harness.request("POST", "/v1/auth/password/forgot", { body: { email } });
  const reset = (harness: Harness, body: Record<string, unknown>) =>
    harness.request("POST", "/v1/auth/password/reset", { body: { email: EMAIL, ...body } });
  const lastCode = (harness: Harness) => harness.verificationEmails.at(-1)?.code ?? "";

  test("answers 202 for an unknown address and sends nothing", async () => {
    const harness = await seeded();
    const res = await forgot(harness, "nobody@mayarin.local");
    expect(res.status).toBe(202);
    expect(harness.verificationEmails).toHaveLength(0);
  });

  test("a code resets the password and signs out every device", async () => {
    const harness = await seeded();
    const before = await signIn(harness);

    expect((await forgot(harness)).status).toBe(202);
    expect(lastCode(harness)).toMatch(/^\d{6}$/);

    const res = await reset(harness, { code: lastCode(harness), newPassword: NEXT });
    expect(res.status).toBe(200);

    expect(await signedIn(harness, before)).toBe(false);
    expect((await signIn(harness, PASSWORD)).res.status).toBe(401);
    expect((await signIn(harness, NEXT)).res.status).toBe(200);
  });

  test("a code works once", async () => {
    const harness = await seeded();
    await forgot(harness);
    const code = lastCode(harness);
    expect((await reset(harness, { code, newPassword: NEXT })).status).toBe(200);
    expect((await reset(harness, { code, newPassword: `${NEXT}-again` })).status).toBe(400);
  });

  test("a wrong code is refused and burns after five", async () => {
    const harness = await seeded();
    await forgot(harness);
    const code = lastCode(harness);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await reset(harness, { code: wrong, newPassword: NEXT })).status).toBe(400);
    }
    expect((await reset(harness, { code, newPassword: NEXT })).status).toBe(400);
    expect((await signIn(harness, PASSWORD)).res.status).toBe(200);
  });

  test("an account with a second factor needs that code as well as the email code", async () => {
    const harness = await seeded();
    const auth = await signIn(harness);
    const secret = await enrol(harness, auth);

    await forgot(harness);
    const code = lastCode(harness);

    expect((await reset(harness, { code, newPassword: NEXT })).status).toBe(403);
    expect((await reset(harness, { code, newPassword: NEXT, mfaCode: "000000" })).status).toBe(401);
    const ok = await reset(harness, {
      code,
      newPassword: NEXT,
      mfaCode: totpCode(secret, STEP + 1),
    });
    expect(ok.status).toBe(200);
  });
});
