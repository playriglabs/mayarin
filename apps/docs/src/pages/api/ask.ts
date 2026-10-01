/**
 * `POST /api/ask` — the Ask AI chat endpoint.
 *
 * Public, so it guards the free model allowance: a per-IP budget, a cap on
 * question length, and only the last few messages of a conversation are sent
 * on, which keeps each question cheap.
 *
 * The budget lives in this process's memory. It resets on restart and is not
 * shared between instances, which is enough for one docs server.
 */

import { createAgentUIStreamResponse } from "ai";
import type { APIRoute } from "astro";
import { askAiAgent, askAiConfigured } from "@/lib/ask-ai";

export const prerender = false;

const WINDOW_MS = 10 * 60_000;
const REQUESTS_PER_WINDOW = 10;
const MAX_MESSAGES = 6;
const MAX_REQUEST_BYTES = 32_000;

const recent = new Map<string, number[]>();

function allow(ip: string, now: number): boolean {
  // Forget visitors whose window has passed, so the map cannot grow forever.
  if (recent.size > 5_000) {
    for (const [key, times] of recent) {
      if (times.every((at) => now - at >= WINDOW_MS)) recent.delete(key);
    }
  }
  const kept = (recent.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  if (kept.length >= REQUESTS_PER_WINDOW) {
    recent.set(ip, kept);
    return false;
  }
  recent.set(ip, [...kept, now]);
  return true;
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!askAiConfigured()) return error(503, "Ask AI is not configured on this server.");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || clientAddress;
  if (!allow(ip, Date.now())) {
    return error(429, "Too many questions. Try again in a few minutes.");
  }

  const body = await request.text();
  if (body.length > MAX_REQUEST_BYTES) return error(413, "That question is too long.");

  let messages: unknown;
  try {
    ({ messages } = JSON.parse(body) as { messages?: unknown });
  } catch {
    return error(400, "The request body is not JSON.");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return error(400, "Send at least one message.");
  }

  return createAgentUIStreamResponse({
    agent: askAiAgent,
    uiMessages: messages.slice(-MAX_MESSAGES),
  });
};
