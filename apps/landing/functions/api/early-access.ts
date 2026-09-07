interface Env {
  readonly EARLY_ACCESS: D1Database;
}

interface EarlyAccessBody {
  readonly email?: unknown;
  readonly company?: unknown;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_LIMIT = 5;
const WINDOW_SECONDS = 600;

async function rateLimit(database: D1Database, request: Request): Promise<Response | undefined> {
  // Cloudflare supplies this header; do not use client-controlled forwarded headers.
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const clientHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const now = Math.floor(Date.now() / 1000);
  // D1 batches are transactions: simultaneous requests share the same counter.
  const results = await database.batch<{ requests: number; expires_at: number }>([
    database.prepare("delete from early_access_rate_limits where expires_at <= ?").bind(now),
    database
      .prepare(
        `insert into early_access_rate_limits (client_hash, requests, expires_at)
         values (?, 1, ?)
         on conflict (client_hash) do update set requests = min(requests + 1, ?)
         returning requests, expires_at`,
      )
      .bind(clientHash, now + WINDOW_SECONDS, REQUEST_LIMIT + 1),
  ]);
  const bucket = results[1]?.results[0];
  if (bucket === undefined) {
    return json({ message: "Could not join. Please try again later." }, 503);
  }
  if (bucket.requests <= REQUEST_LIMIT) return undefined;

  const retryAfter = Math.max(1, bucket.expires_at - now);
  return Response.json(
    { message: "Too many attempts. Please wait a few minutes before trying again." },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}

const json = (body: Readonly<Record<string, string>>, status = 200): Response =>
  Response.json(body, { status });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const limited = await rateLimit(env.EARLY_ACCESS, request);
  if (limited !== undefined) return limited;

  let body: EarlyAccessBody;
  try {
    const payload: unknown = await request.json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return json({ message: "Send a valid email address." }, 400);
    }
    body = payload;
  } catch {
    return json({ message: "Send a valid email address." }, 400);
  }

  if (typeof body.company === "string" && body.company !== "") {
    return json({ message: "You are on the early-access list." });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) {
    return json({ message: "Enter a valid work email." }, 400);
  }

  await env.EARLY_ACCESS.prepare(
    `insert into early_access_signups (id, email, created_at)
     values (?, ?, unixepoch())
     on conflict (email) do nothing`,
  )
    .bind(crypto.randomUUID(), email)
    .run();

  return json({ message: "You are on the early-access list." }, 201);
};
