import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import { createApiKey, deactivateApiKey } from "../src/api-key.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function key() {
  return createApiKey({
    merchantId: "mrc_1",
    name: "POS register 3",
    secretHash: "hash-of-secret",
    prefix: "pk_ab12cd34",
    permissions: ["payments:read"],
    now: NOW,
  });
}

describe("createApiKey", () => {
  test("starts active, at version 1, with a mak_ id", () => {
    const k = key();
    expect(k.id).toMatch(/^mak_/);
    expect(k.active).toBe(true);
    expect(k.version).toBe(1);
    expect(k.permissions).toEqual(["payments:read"]);
  });

  test("trims the name", () => {
    const k = createApiKey({
      merchantId: "mrc_1",
      name: "  Register  ",
      secretHash: "h",
      prefix: "p",
      permissions: ["payments:read"],
      now: NOW,
    });
    expect(k.name).toBe("Register");
  });

  test("an empty name is refused", () => {
    expect(() =>
      createApiKey({
        merchantId: "mrc_1",
        name: "  ",
        secretHash: "h",
        prefix: "p",
        permissions: ["payments:read"],
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });

  test("a key with no permissions is refused", () => {
    expect(() =>
      createApiKey({
        merchantId: "mrc_1",
        name: "K",
        secretHash: "h",
        prefix: "p",
        permissions: [],
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });

  test("copies the permissions so a later mutation of the input array cannot drift the key", () => {
    const perms = ["payments:read"] as const;
    const k = createApiKey({
      merchantId: "mrc_1",
      name: "K",
      secretHash: "h",
      prefix: "p",
      permissions: perms,
      now: NOW,
    });
    expect(k.permissions).not.toBe(perms);
    expect(k.permissions).toEqual([...perms]);
  });
});

describe("deactivateApiKey", () => {
  test("marks the key inactive and bumps the version", () => {
    const deactivated = deactivateApiKey(key(), NOW);
    expect(deactivated.active).toBe(false);
    expect(deactivated.version).toBe(2);
  });

  test("deactivating an already-inactive key is refused", () => {
    const deactivated = deactivateApiKey(key(), NOW);
    expect(() => deactivateApiKey(deactivated, NOW)).toThrow(ValidationError);
  });
});

describe("api key kinds (#113)", () => {
  test("defaults to secret", () => {
    expect(key().kind).toBe("secret");
  });

  test("a secret key must grant at least one permission", () => {
    expect(() =>
      createApiKey({
        merchantId: "mrc_1",
        name: "POS",
        secretHash: "h",
        prefix: "sk_ab12cd34",
        permissions: [],
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });

  test("a publishable key carries no permissions", () => {
    const k = createApiKey({
      merchantId: "mrc_1",
      kind: "publishable",
      name: "Storefront",
      secretHash: "h",
      prefix: "pk_ab12cd34",
      permissions: [],
      now: NOW,
    });
    expect(k.kind).toBe("publishable");
    expect(k.permissions).toEqual([]);
  });

  test("a publishable key with permissions is refused", () => {
    expect(() =>
      createApiKey({
        merchantId: "mrc_1",
        kind: "publishable",
        name: "Storefront",
        secretHash: "h",
        prefix: "pk_ab12cd34",
        permissions: ["catalog:manage"],
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });
});
