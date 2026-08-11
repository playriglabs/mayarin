import { describe, expect, test } from "bun:test";
import { ProviderError } from "@mayarin/shared";
import { Hono } from "hono";
import { type ErrorBody, errorHandler } from "../src/errors.ts";

function errorApp(error: Error): Hono {
  const app = new Hono();
  app.get("/", () => {
    throw error;
  });
  app.onError(errorHandler);
  return app;
}

describe("error retryability on the wire", () => {
  test.each([
    [true, "temporary provider failure"],
    [false, "permanent provider failure"],
  ] as const)("serializes retryable=%s", async (retryable, message) => {
    const response = await errorApp(new ProviderError(message, {}, { retryable })).request("/");
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toMatchObject({ code: "PROVIDER_ERROR", retryable });
  });
});
