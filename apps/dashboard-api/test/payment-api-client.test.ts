import { describe, expect, test } from "bun:test";
import { ConflictError, NotFoundError, ProviderError, ValidationError } from "@mayarin/shared";
import { PaymentApiClient } from "../src/services/payment-api-client.ts";

const refusal = (status: number, message: string): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ error: { code: "X", message } }), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

const clientAnswering = (status: number, message = "no") =>
  new PaymentApiClient({
    baseUrl: "https://core.example",
    internalToken: "t",
    fetch: refusal(status, message),
  });

describe("PaymentApiClient refusals", () => {
  test("a 409 from the payment API stays a 409 with its message, not a 502", async () => {
    const message =
      "Only a payment whose funds arrived can be retried; start a new payment instead";
    const error = await clientAnswering(409, message)
      .retry("pi_1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe(message);
    expect((error as ConflictError).httpStatus).toBe(409);
  });

  test("a 404 and a 400 keep their meaning", async () => {
    expect(
      await clientAnswering(404)
        .retry("pi_1")
        .catch((e: unknown) => e),
    ).toBeInstanceOf(NotFoundError);
    expect(
      await clientAnswering(400)
        .retry("pi_1")
        .catch((e: unknown) => e),
    ).toBeInstanceOf(ValidationError);
  });

  test("an outage, a throttle or a credential problem is still a provider error", async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      expect(
        await clientAnswering(status)
          .retry("pi_1")
          .catch((e: unknown) => e),
      ).toBeInstanceOf(ProviderError);
    }
  });
});
