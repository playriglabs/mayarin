import { describe, expect, test } from "bun:test";
import {
  ConcurrencyError,
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  InvalidStateTransitionError,
  isMayarinError,
  LedgerImbalanceError,
  type MayarinError,
  NotFoundError,
  ProviderError,
  UnauthorizedError,
  ValidationError,
} from "../src/errors.ts";

describe("error taxonomy", () => {
  test("every domain error is a MayarinError and reports its code and status", () => {
    const cases: Array<{ error: MayarinError; code: string; status: number }> = [
      { error: new ValidationError("bad"), code: "VALIDATION_ERROR", status: 400 },
      { error: new NotFoundError("missing"), code: "NOT_FOUND", status: 404 },
      { error: new ConflictError("clash"), code: "CONFLICT", status: 409 },
      { error: new IdempotencyConflictError("replay"), code: "IDEMPOTENCY_CONFLICT", status: 409 },
      {
        error: new InvalidStateTransitionError("nope"),
        code: "INVALID_STATE_TRANSITION",
        status: 409,
      },
      { error: new ConcurrencyError("race"), code: "CONCURRENCY_CONFLICT", status: 409 },
      { error: new LedgerImbalanceError("unbalanced"), code: "LEDGER_IMBALANCE", status: 500 },
      { error: new ProviderError("down"), code: "PROVIDER_ERROR", status: 502 },
      { error: new ConfigurationError("bad env"), code: "CONFIGURATION_ERROR", status: 500 },
      { error: new UnauthorizedError("no session"), code: "UNAUTHORIZED", status: 401 },
      { error: new ForbiddenError("not allowed"), code: "FORBIDDEN", status: 403 },
    ];

    for (const { error, code, status } of cases) {
      expect(isMayarinError(error)).toBe(true);
      expect(error.code).toBe(code);
      expect(error.httpStatus).toBe(status);
    }
  });

  test("isMayarinError rejects non-domain errors", () => {
    expect(isMayarinError(new Error("plain"))).toBe(false);
    expect(isMayarinError("string")).toBe(false);
  });

  test("auth errors are terminal, not retryable", () => {
    expect(new UnauthorizedError("x").retryable).toBe(false);
    expect(new ForbiddenError("x").retryable).toBe(false);
  });

  test("details are carried through and serializable", () => {
    const error = new UnauthorizedError("no session", { reason: "expired" });
    expect(error.details).toEqual({ reason: "expired" });
    expect(error.toJSON()).toEqual({
      code: "UNAUTHORIZED",
      message: "no session",
      details: { reason: "expired" },
    });
  });
});
