import { describe, expect, test } from "bun:test";
import { dashboardErrorMessage } from "./error-message";

describe("dashboardErrorMessage", () => {
  test("turns raw provider failures into compact recovery copy", () => {
    expect(
      dashboardErrorMessage(
        {
          error: {
            code: "PROVIDER_ERROR",
            message:
              "This idempotency key has been used with this HTTP method and endpoint within the last 24 hours, but the request body was modified.",
          },
        },
        502,
      ),
    ).toBe("A connected service could not complete this request. Try again.");
  });

  test("keeps short validation guidance that tells the user what to fix", () => {
    expect(
      dashboardErrorMessage(
        { error: { code: "VALIDATION_ERROR", message: "Add a client email address." } },
        400,
      ),
    ).toBe("Add a client email address.");
  });

  test("does not expose an unexpectedly long unclassified message", () => {
    expect(
      dashboardErrorMessage({ error: { code: "UNKNOWN", message: "x".repeat(121) } }, 500),
    ).toBe("The request could not be completed. Please try again.");
  });
});
