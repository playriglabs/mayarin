import { describe, expect, test } from "bun:test";
import { ApiError } from "./api/client";
import { formatRetryAfter, loginFailureOf } from "./login-failure";

describe("loginFailureOf", () => {
  test("keeps invalid credentials distinct from rate limiting", () => {
    expect(
      loginFailureOf(new ApiError({ status: 401, message: "Invalid email or password" })),
    ).toEqual({ type: "error", reason: "Invalid email or password" });

    expect(
      loginFailureOf(
        new ApiError({
          status: 429,
          message: "Too many requests. Try again later.",
          retryAfterSeconds: 286,
        }),
      ),
    ).toEqual({
      type: "blocked",
      reason: "Too many requests. Try again later.",
      retryAfterSeconds: 286,
    });
  });
});

describe("formatRetryAfter", () => {
  test("formats the remaining cooldown without hiding seconds", () => {
    expect(formatRetryAfter(286)).toBe("4m 46s");
    expect(formatRetryAfter(9)).toBe("9s");
  });
});
