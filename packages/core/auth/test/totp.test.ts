import { describe, expect, test } from "bun:test";
import {
  hashRecoveryCode,
  matchTotp,
  newRecoveryCode,
  newTotpSecret,
  otpauthUri,
  totpCode,
  totpStepAt,
} from "../src/totp.ts";

// RFC 6238 Appendix B, SHA-1, secret "12345678901234567890" (base32 below).
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  test("matches the RFC 6238 SHA-1 vectors (six digits)", () => {
    // T = 59 s -> 94287082 -> last six 287082; T = 1111111109 -> 081804.
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
  });

  test("accepts the current step and one either side, nothing wider", () => {
    const now = new Date(1_700_000_000_000);
    const step = totpStepAt(now);
    const secret = newTotpSecret();

    expect(matchTotp(secret, totpCode(secret, step), now)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpCode(secret, step - 2), now)).toBeUndefined();
  });

  test("rejects a malformed code without computing", () => {
    const secret = newTotpSecret();
    for (const code of ["", "12345", "1234567", "abcdef", "12 456"]) {
      expect(matchTotp(secret, code, new Date())).toBeUndefined();
    }
  });

  test("the QR payload carries what an authenticator needs", () => {
    const uri = otpauthUri({ secret: "ABC", account: "a@b.co", issuer: "Mayarin" });
    expect(uri).toStartWith("otpauth://totp/Mayarin:a%40b.co?");
    expect(uri).toContain("secret=ABC");
    expect(uri).toContain("issuer=Mayarin");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  test("recovery codes hash the same however they are typed", () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code.toLowerCase().replace("-", " ")));
    expect(hashRecoveryCode(code)).not.toBe(hashRecoveryCode(newRecoveryCode()));
  });
});
