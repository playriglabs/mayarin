/**
 * Transport-level error mapping.
 *
 * Domain errors carry their own stable `code` and HTTP status; everything else
 * becomes a 500 with no internal detail leaked to the caller.
 */

import { isMayarinError } from "@mayarin/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly details?: Record<string, unknown>;
  };
}

export function errorHandler(error: Error, c: Context): Response {
  if (error instanceof ZodError) {
    return c.json<ErrorBody>(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          retryable: false,
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        },
      },
      400,
    );
  }

  if (isMayarinError(error)) {
    // A domain error is an answer, not a crash — but it is still the only
    // record that anything went wrong. Logging only the unhandled branch left
    // a deployment where every refused settlement was invisible, and a `502`
    // from the origin looked identical to the origin being down.
    console.error(
      `[api] ${c.req.method} ${c.req.path} -> ${error.httpStatus} ${error.code}: ${error.message}`,
      error.details,
    );
    return c.json<ErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(Object.keys(error.details).length === 0 ? {} : { details: error.details }),
        },
      },
      error.httpStatus as ContentfulStatusCode,
    );
  }

  console.error("[api] unhandled error", error);
  return c.json<ErrorBody>(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        retryable: false,
      },
    },
    500,
  );
}
