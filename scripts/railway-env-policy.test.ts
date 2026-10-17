import { describe, expect, test } from "bun:test";
import { isSensitive, unexpectedRemoteSecrets, unreviewedKeys } from "./railway-env-policy.ts";

const policy = {
  allowed: new Set(["OPERATOR_PRIVATE_KEY"]),
  withheld: new Set(["ADMIN_TOKEN"]),
};

describe("railway env policy", () => {
  test("recognises credentials and leaves identifiers alone", () => {
    for (const key of ["OPERATOR_PRIVATE_KEY", "ADMIN_TOKEN", "DEPOSIT_XPUB", "R2_ACCESS_KEY_ID"]) {
      expect(isSensitive(key)).toBe(true);
    }
    for (const key of ["TURNKEY_ORGANIZATION_ID", "WATCHER_TOKEN_BALANCE_CATCH_UP", "PORT"]) {
      expect(isSensitive(key)).toBe(false);
    }
  });

  test("a secret nobody reviewed is reported, an allowed or withheld one is not", () => {
    expect(
      unreviewedKeys(["OPERATOR_PRIVATE_KEY", "ADMIN_TOKEN", "NEW_API_KEY", "PORT"], policy),
    ).toEqual(["NEW_API_KEY"]);
  });

  test("a withheld secret already on the service is unexpected there", () => {
    expect(
      unexpectedRemoteSecrets(["ADMIN_TOKEN", "OPERATOR_PRIVATE_KEY", "PORT"], policy),
    ).toEqual(["ADMIN_TOKEN"]);
  });
});
