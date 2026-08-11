const DEFAULT_TOLERANCE_SECONDS = 300;
const encoder = new TextEncoder();

export type WebhookVerificationCode = "INVALID_SIGNATURE" | "STALE_TIMESTAMP" | "INVALID_PAYLOAD";

export class MayarinWebhookError extends Error {
  readonly code: WebhookVerificationCode;

  constructor(code: WebhookVerificationCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MayarinWebhookError";
    this.code = code;
  }
}

export interface VerifyWebhookOptions {
  readonly payload: string;
  readonly signature: string;
  readonly secret: string;
  readonly now?: Date;
  readonly toleranceSeconds?: number;
}

export async function verifyWebhook(options: VerifyWebhookOptions): Promise<void> {
  const parsed = parseSignature(options.signature);
  if (parsed === undefined)
    throw new MayarinWebhookError("INVALID_SIGNATURE", "The webhook signature is malformed");

  const now = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    throw new MayarinWebhookError("STALE_TIMESTAMP", "The webhook timestamp is outside tolerance");
  }

  const expected = await hmac(options.secret, `${parsed.timestamp}.${options.payload}`);
  if (!parsed.signatures.some((candidate) => constantTimeEqual(candidate, expected))) {
    throw new MayarinWebhookError("INVALID_SIGNATURE", "The webhook signature does not match");
  }
}

export async function constructWebhook<T = unknown>(options: VerifyWebhookOptions): Promise<T> {
  await verifyWebhook(options);
  try {
    return JSON.parse(options.payload) as T;
  } catch (error) {
    throw new MayarinWebhookError("INVALID_PAYLOAD", "The webhook payload is not JSON", {
      cause: error,
    });
  }
}

function parseSignature(
  header: string,
): { readonly timestamp: number; readonly signatures: readonly string[] } | undefined {
  const parts = header.split(",").map((part) => part.split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts
    .filter(([key, value]) => key === "v1" && value !== undefined)
    .map(([, value]) => value)
    .filter((value): value is string => value !== undefined);
  return Number.isInteger(timestamp) && signatures.length > 0
    ? { timestamp, signatures }
    : undefined;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
