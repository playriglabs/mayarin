import { describe, expect, test } from "bun:test";
import {
  isPermission,
  MERCHANT_ADMIN_PERMISSIONS,
  PERMISSION_LABELS,
  PERMISSION_LIST,
} from "../src/permission.ts";

describe("permission", () => {
  test("the permission list is exactly the five flags", () => {
    expect(PERMISSION_LIST).toEqual([
      "payments:read",
      "users:manage",
      "admin:access",
      "settings:manage",
      "catalog:manage",
    ]);
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

  test("a freshly seeded merchant-admin carries every permission", () => {
    expect(MERCHANT_ADMIN_PERMISSIONS).toEqual([
      "payments:read",
      "users:manage",
      "admin:access",
      "settings:manage",
      "catalog:manage",
    ]);
  });
});
