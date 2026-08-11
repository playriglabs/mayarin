import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import { createCustomer, updateCustomer } from "../src/customer.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function customer() {
  return createCustomer({
    merchantId: "mrc_1",
    name: "Budi",
    email: "budi@example.com",
    notes: "Regular",
    now: NOW,
  });
}

describe("createCustomer", () => {
  test("trims name/email/notes and starts at version 1", () => {
    const c = createCustomer({
      merchantId: "mrc_1",
      name: "  Sari  ",
      email: "  sari@example.com  ",
      notes: "  Walk-in  ",
      now: NOW,
    });
    expect(c.name).toBe("Sari");
    expect(c.email).toBe("sari@example.com");
    expect(c.notes).toBe("Walk-in");
    expect(c.version).toBe(1);
    expect(c.id).toMatch(/^cus_/);
  });

  test("a name with only whitespace is refused", () => {
    expect(() => createCustomer({ merchantId: "mrc_1", name: "   ", now: NOW })).toThrow(
      ValidationError,
    );
  });

  test("email and notes are optional", () => {
    const c = createCustomer({ merchantId: "mrc_1", name: "Walk-in", now: NOW });
    expect(c.email).toBeUndefined();
    expect(c.notes).toBeUndefined();
  });

  test("an email without an @ is refused", () => {
    expect(() =>
      createCustomer({ merchantId: "mrc_1", name: "Budi", email: "notanemail", now: NOW }),
    ).toThrow(ValidationError);
  });

  test("blank notes are dropped", () => {
    const c = createCustomer({ merchantId: "mrc_1", name: "Budi", notes: "   ", now: NOW });
    expect(c.notes).toBeUndefined();
  });
});

describe("updateCustomer", () => {
  test("bumps the version and applies the new name", () => {
    const updated = updateCustomer(customer(), { name: "Budi Hartono" }, NOW);
    expect(updated.name).toBe("Budi Hartono");
    expect(updated.version).toBe(2);
  });

  test("email: null clears, absent leaves it alone", () => {
    const cleared = updateCustomer(customer(), { email: null }, NOW);
    expect(cleared.email).toBeUndefined();
    const untouched = updateCustomer(customer(), {}, NOW);
    expect(untouched.email).toBe("budi@example.com");
  });

  test("notes: null clears, absent leaves it alone", () => {
    const cleared = updateCustomer(customer(), { notes: null }, NOW);
    expect(cleared.notes).toBeUndefined();
    expect(updateCustomer(customer(), {}, NOW).notes).toBe("Regular");
  });

  test("an invalid email on update is refused", () => {
    expect(() => updateCustomer(customer(), { email: "nope" }, NOW)).toThrow(ValidationError);
  });
});
