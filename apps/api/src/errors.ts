/**
 * Transport-level error mapping.
 *
 * Domain errors carry their own stable `code` and HTTP status; everything else
 * becomes a 500 with no internal detail leaked to the caller.
 */

import { isMayarrError } from "@mayarr/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
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

  if (isMayarrError(error)) {
    return c.json<ErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(Object.keys(error.details).length === 0 ? {} : { details: error.details }),
        },
      },
      error.httpStatus as ContentfulStatusCode,
    );
  }

  console.error("[api] unhandled error", error);
  return c.json<ErrorBody>(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    500,
  );
}
