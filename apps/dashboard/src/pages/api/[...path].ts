/** Same-origin proxy from the dashboard to its Railway API. */

import type { APIRoute } from "astro";
import { getApiOrigin } from "@/lib/api/origin";
import { apiProxyHeaders, apiProxyResponseHeaders } from "@/lib/api/proxy-headers";
import {
  capBytes,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  UPSTREAM_TIMEOUT_MS,
} from "@/lib/api/proxy-limits";
import { apiProxyUrl } from "@/lib/api/proxy-url";

const WITHOUT_BODY = new Set(["GET", "HEAD"]);

/**
 * The proxy's own refusals, in the API's error shape. As plain text the client
 * cannot read them and reports "Invalid JSON response" for every one of them.
 */
const refusal = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

export const ALL: APIRoute = async (context) => {
  const upstreamPath = context.url.pathname.slice("/api".length);
  let url: URL;
  try {
    url = apiProxyUrl(upstreamPath, context.url.search, getApiOrigin());
  } catch {
    return refusal(404, "NOT_FOUND", "Not found");
  }

  const { request } = context;
  const hasBody = !WITHOUT_BODY.has(request.method) && request.body !== null;
  if (hasBody) {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_REQUEST_BYTES)
      return refusal(413, "PAYLOAD_TOO_LARGE", "That request is too large");
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers: apiProxyHeaders(request.headers),
      redirect: "manual",
      // Ends on the client going away as well as on the deadline.
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      ...(hasBody
        ? {
            body: request.body?.pipeThrough(capBytes(MAX_REQUEST_BYTES)),
            duplex: "half",
          }
        : {}),
    });
  } catch {
    return refusal(
      502,
      "UPSTREAM_UNAVAILABLE",
      "The server did not answer in time. Try again in a moment.",
    );
  }

  return new Response(upstream.body?.pipeThrough(capBytes(MAX_RESPONSE_BYTES)) ?? null, {
    status: upstream.status,
    headers: apiProxyResponseHeaders(upstream.headers),
  });
};
