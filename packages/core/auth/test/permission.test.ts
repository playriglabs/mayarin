import { describe, expect, test } from "bun:test";
import {
  GRANTABLE_PERMISSIONS,
  isPermission,
  MERCHANT_ADMIN_PERMISSIONS,
  PERMISSION_LABELS,
  PERMISSION_LIST,
} from "../src/permission.ts";

describe("permission", () => {
  test("the permission list is the five merchant flags plus the platform's arbiter", () => {
    expect(PERMISSION_LIST).toEqual([
      "payments:read",
      "users:manage",
      "admin:access",
      "settings:manage",
      "catalog:manage",
      "disputes:arbitrate",
    ]);
  });

  test("a merchant can grant every permission but disputes:arbitrate (#313)", () => {
    expect(GRANTABLE_PERMISSIONS).not.toContain("disputes:arbitrate");
    expect(GRANTABLE_PERMISSIONS).toHaveLength(PERMISSION_LIST.length - 1);
  });

  test("isPermission narrows and rejects unknown values", () => {
    expect(isPermission("payments:read")).toBe(true);
    expect(isPermission("users:manage")).toBe(true);
    expect(isPermission("admin:access")).toBe(true);
    expect(isPermission("superuser")).toBe(false);
    expect(isPermission(undefined)).toBe(false);
  });

  test("the label table covers every permission", () => {
    for (const permission of PERMISSION_LIST) {
      expect(PERMISSION_LABELS[permission]).toBeTypeOf("string");
      expect(PERMISSION_LABELS[permission].length).toBeGreaterThan(0);
    }
  });

  test("a freshly seeded merchant-admin carries every grantable permission", () => {
    expect(MERCHANT_ADMIN_PERMISSIONS).toEqual([
      "payments:read",
      "users:manage",
      "admin:access",
      "settings:manage",
      "catalog:manage",
    ]);
  });
});
