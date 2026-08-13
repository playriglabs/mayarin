interface Env {
  readonly EARLY_ACCESS: D1Database;
}

interface EarlyAccessBody {
  readonly email?: unknown;
  readonly company?: unknown;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: Readonly<Record<string, string>>, status = 200): Response =>
  Response.json(body, { status });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: EarlyAccessBody;
  try {
    body = (await request.json()) as EarlyAccessBody;
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
