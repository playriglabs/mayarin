import { describe, expect, test } from "bun:test";
import { csrfTokenOf, newSessionId, sessionKey } from "../src/session-token.ts";

describe("session tokens", () => {
  test("ids are long, unique and prefixed", () => {
    const [a, b] = [newSessionId(), newSessionId()];
    expect(a).not.toBe(b);
    expect(a.startsWith("ses_")).toBe(true);
    expect(a.length).toBeGreaterThan(40);
  });

  test("the stored key and the CSRF token are stable, distinct and hide the id", () => {
    const id = newSessionId();
    expect(sessionKey(id)).toBe(sessionKey(id));
    expect(csrfTokenOf(id)).toBe(csrfTokenOf(id));
    expect(sessionKey(id)).not.toContain(id);
    expect(csrfTokenOf(id)).not.toContain(id);
    expect(sessionKey(id)).not.toBe(csrfTokenOf(id));
    expect(csrfTokenOf(id)).not.toBe(csrfTokenOf(newSessionId()));
  });
});
