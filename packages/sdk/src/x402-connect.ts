/**
 * The x402 gate as connect middleware (#269).
 *
 * Works anywhere a `(req, res, next)` function does — Express, Connect, a raw
 * `node:http` server, a Vite dev server — because Express middleware *is*
 * connect middleware, and the adapter needs nothing else from the framework.
 * Typed against `node:http` only, so the SDK carries no framework dependency.
 *
 * Usage:
 *
 * ```ts
 * const gate = createX402Gate({ baseUrl, resourceId: "premium" });
 * app.get("/premium", x402Connect(gate), paidHandler);
 * ```
 *
 * Semantics, all decided by the core (`./x402.ts`) and only spelled here:
 *
 * - unpaid → `402` with `PAYMENT-REQUIRED`, empty body — the spec's shape.
 * - replayed → the recorded response again, verbatim; `next` never runs.
 * - settled → `PAYMENT-RESPONSE` is set first, then the merchant's handler
 *   runs, then the response is recorded for replay once it has finished.
 * - a Mayarin outage → `502` JSON, and the handler never runs: the merchant
 *   does not serve paid content on Mayarin's say-so being *missing*.
 *
 * The captured response is the whole delivery policy: it assumes a response
 * that can be re-served in full. A stream that never ends cannot be replayed,
 * and a range request re-served in full is a wrong answer — gate content that
 * has one.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_REQUIRED_STATUS,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "@mayarin/x402";
import type { X402Gate, X402ServedResponse } from "./x402.ts";
import { MayarinX402Error } from "./x402.ts";

type NextHandleFunction = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

export function x402Connect(gate: X402Gate): NextHandleFunction {
  return (req, res, next) => {
    const signature = req.headers[PAYMENT_SIGNATURE_HEADER.toLowerCase()];
    if (Array.isArray(signature)) {
      res.statusCode = 400;
      res.end();
      return;
    }

    void gate
      .decide(signature)
      .then((decision) => {
        if (decision.kind === "payment-required") {
          res.statusCode = PAYMENT_REQUIRED_STATUS;
          res.setHeader(PAYMENT_REQUIRED_HEADER, decision.paymentRequiredHeader);
          res.end();
          return;
        }

        if (decision.kind === "replayed") {
          serveRecorded(res, decision.served);
          return;
        }

        res.setHeader(PAYMENT_RESPONSE_HEADER, decision.paymentResponseHeader);
        captureResponse(res, (served) => decision.remember(served));
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof MayarinX402Error) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        next(error);
      });
  };
}

function serveRecorded(res: ServerResponse, served: X402ServedResponse): void {
  res.statusCode = served.status;
  for (const header of served.headers) res.setHeader(header.name, header.value);
  res.end(served.body);
}

/**
 * Record what crossed the wire, once it has all crossed.
 *
 * `write` and `end` are wrapped rather than listened for because a listener on
 * `finish` cannot see the body — the bytes are gone by then. `end` answers a
 * response exactly once, so recording inside it records exactly one delivery.
 */
function captureResponse(res: ServerResponse, record: (served: X402ServedResponse) => void): void {
  const chunks: Buffer[] = [];
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  // Widest-arity wrappers, because `write` and `end` are overloaded and a
  // `Parameters<>` of an overloaded method narrows what a handler may call.
  res.write = ((...args: unknown[]) => {
    collect(chunks, args[0]);
    return originalWrite(...(args as Parameters<typeof originalWrite>));
  }) as typeof res.write;

  res.end = ((...args: unknown[]) => {
    collect(chunks, args[0]);
    const finished = originalEnd(...(args as Parameters<typeof originalEnd>));
    record({
      status: res.statusCode,
      headers: headerEntries(res),
      body: Buffer.concat(chunks),
    });
    return finished;
  }) as typeof res.end;
}

function collect(chunks: Buffer[], chunk: unknown): void {
  if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
  else if (Buffer.isBuffer(chunk)) chunks.push(chunk);
}

function headerEntries(res: ServerResponse): { name: string; value: string }[] {
  const entries: { name: string; value: string }[] = [];
  for (const [name, value] of Object.entries(res.getHeaders())) {
    if (typeof value === "string") entries.push({ name, value });
    else if (Array.isArray(value)) {
      for (const item of value) entries.push({ name, value: String(item) });
    } else if (value !== undefined) {
      entries.push({ name, value: String(value) });
    }
  }
  return entries;
}
