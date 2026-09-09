/**
 * The x402 gate: sell an endpoint you host, per request (#269).
 *
 * A merchant server that wants paid traffic puts this in front of a route. A
 * request without a payment is answered with Mayarin's price in the standard
 * `PAYMENT-REQUIRED` header; a request carrying a payer's signature is settled
 * by Mayarin first, and only a settled request reaches the merchant's own
 * handler — a response cannot be un-served, so nothing runs before the charge.
 *
 * The happy path is one settle, no verify: Mayarin rebuilds the requirements
 * from the registered resource and reads the transfer back off the chain, so
 * verification is part of settling, not a separate round-trip.
 *
 * Framework-neutral on purpose — this file decides what the decision *is*,
 * adapters spell it in a framework's request and response types. Effects are
 * injected (`fetch`, `now`) so the whole cycle is testable without a server.
 *
 * The request-time surface is public and keyless: no merchant credential rides
 * on a payment. The secret key registers the resource (`x402.resources`), and
 * after that the payer pays and Mayarin settles.
 */

import {
  decodePaymentPayload,
  eip3009PayloadOf,
  encodePaymentRequired,
  encodeSettleResponse,
  idempotencyKeyOf,
  type PaymentPayload,
  type PaymentRequired,
  parseUnixSeconds,
  type SettleResponse,
  X402_VERSION,
} from "@mayarin/x402";
import { errorFromResponse } from "./errors.ts";

export type X402GateErrorCode = "PRICE_UNAVAILABLE" | "SETTLE_UNAVAILABLE";

/** Both codes mean the payer can retry the same request unchanged. */
export class MayarinX402Error extends Error {
  readonly code: X402GateErrorCode;
  readonly retryable = true;

  constructor(code: X402GateErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MayarinX402Error";
    this.code = code;
  }
}

/** One response the merchant served, replayable verbatim. */
export interface X402ServedResponse {
  readonly status: number;
  readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly body: Uint8Array;
}

export interface X402ReplayStore {
  get(key: string): X402ServedResponse | undefined;
  put(key: string, served: X402ServedResponse, expiresAt: Date): void;
}

/**
 * The delivery policy: one authorization buys one execution.
 *
 * A replayed signature re-serves the recorded response — no second charge, no
 * second handler run, and a payer whose HTTP response was lost on the way back
 * gets it again. In memory and per-process; the entry dies with the
 * authorization's `validBefore`, which is the whole window in which the payer
 * could legally retry, so the store's size is bounded by live payments alone.
 * After a restart the store is empty and Mayarin refuses the spent nonce
 * fail-closed: still no second charge, but no re-serve either — restarts
 * during a payment are the merchant's operational problem, not the payer's.
 */
export function createReplayStore(now: () => Date): X402ReplayStore {
  const entries = new Map<string, { served: X402ServedResponse; expiresAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= now().getTime()) {
        entries.delete(key);
        return undefined;
      }
      return entry.served;
    },
    put(key, served, expiresAt) {
      entries.set(key, { served, expiresAt: expiresAt.getTime() });
    },
  };
}

export interface X402GateConfig {
  /** Origin of the payment API, e.g. `https://api.mayarin.xyz`. */
  readonly baseUrl: string;
  /** The registered resource this gate sells. */
  readonly resourceId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly replays?: X402ReplayStore;
}

export type X402GateDecision =
  | {
      readonly kind: "payment-required";
      readonly paymentRequired: PaymentRequired;
      /** The header value: base64 of the `paymentRequired` JSON. */
      readonly paymentRequiredHeader: string;
    }
  | {
      readonly kind: "settled";
      readonly settleResponse: SettleResponse;
      /** The header value: base64 of the `settleResponse` JSON. */
      readonly paymentResponseHeader: string;
      /** Called by the adapter once the handler's response is on the wire. */
      readonly remember: (served: X402ServedResponse) => void;
    }
  | {
      readonly kind: "replayed";
      readonly served: X402ServedResponse;
    };

export interface X402Gate {
  decide(signatureHeader: string | undefined): Promise<X402GateDecision>;
}

export function createX402Gate(config: X402GateConfig): X402Gate {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const now = config.now ?? (() => new Date());
  const replays = config.replays ?? createReplayStore(now);
  const base = config.baseUrl.replace(/\/+$/, "");
  const resourcePath = `/x402/resources/${encodeURIComponent(config.resourceId)}`;

  async function quote(): Promise<PaymentRequired> {
    let response: Response;
    try {
      response = await fetchFn(`${base}${resourcePath}/payment-required`);
    } catch (error) {
      throw new MayarinX402Error("PRICE_UNAVAILABLE", "Mayarin could not be reached to quote", {
        cause: error,
      });
    }
    const payload = await readJson(response);
    if (!response.ok) {
      throw new MayarinX402Error(
        "PRICE_UNAVAILABLE",
        `Mayarin refused to quote: ${reasonOf(payload)}`,
        { cause: errorFromResponse(response.status, payload) },
      );
    }
    if (!isPaymentRequired(payload)) {
      throw new MayarinX402Error("PRICE_UNAVAILABLE", "Mayarin answered a quote that is not one");
    }
    return payload;
  }

  // The quote a failed settle is reported against. Always fetched fresh — a
  // 402 is a price, not a promise, and a cached one is a price that may no
  // longer be honoured.
  let quoted: PaymentRequired;

  async function unpaid(error?: string): Promise<X402GateDecision> {
    quoted = await quote();
    const required: PaymentRequired = error === undefined ? quoted : { ...quoted, error };
    return {
      kind: "payment-required",
      paymentRequired: required,
      paymentRequiredHeader: encodePaymentRequired(required),
    };
  }

  return {
    async decide(signatureHeader) {
      if (signatureHeader === undefined) return unpaid();

      // A structurally bad signature is an unpaid request, not an error: the
      // payer gets a fresh price and the standard retry cycle. The same holds
      // for a nonce `idempotencyKeyOf` refuses, and for a payload that is not
      // EIP-3009 — the one scheme this deployment settles.
      let payment: PaymentPayload;
      let key: string;
      try {
        payment = decodePaymentPayload(signatureHeader);
        parseUnixSeconds(eip3009PayloadOf(payment).authorization.validBefore, "validBefore");
        key = idempotencyKeyOf(payment);
      } catch (error) {
        return unpaid(error instanceof Error ? error.message : "unreadable payment");
      }

      const served = replays.get(key);
      if (served !== undefined) return { kind: "replayed", served };

      let response: Response;
      try {
        response = await fetchFn(`${base}${resourcePath}/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            x402Version: X402_VERSION,
            paymentPayload: payment,
            paymentRequirements: payment.accepted,
          }),
        });
      } catch (error) {
        throw new MayarinX402Error("SETTLE_UNAVAILABLE", "Mayarin could not be reached to settle", {
          cause: error,
        });
      }
      const payload = await readJson(response);
      if (!response.ok || !isSettleResponse(payload) || !payload.success) {
        return unpaid(settleFailure(response.status, payload));
      }

      const validBefore = parseUnixSeconds(
        eip3009PayloadOf(payment).authorization.validBefore,
        "validBefore",
      );
      return {
        kind: "settled",
        settleResponse: payload,
        paymentResponseHeader: encodeSettleResponse(payload),
        remember: (servedResponse) =>
          replays.put(key, servedResponse, new Date(Number(validBefore) * 1000)),
      };
    },
  };
}

/** The one-line reason a settle failed, for the next 402's `error` field. */
function settleFailure(status: number, payload: unknown): string {
  if (isSettleResponse(payload) && payload.errorReason !== undefined) {
    return payload.errorReason;
  }
  const api = payload as { error?: { message?: string } } | null;
  if (api?.error?.message !== undefined) return api.error.message;
  return `settle answered ${status}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function reasonOf(payload: unknown): string {
  const api = payload as { error?: { message?: string } } | null;
  return api?.error?.message ?? "no reason given";
}

function isPaymentRequired(value: unknown): value is PaymentRequired {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { accepts?: unknown }).accepts)
  );
}

function isSettleResponse(value: unknown): value is SettleResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { success?: unknown }).success === "boolean"
  );
}
