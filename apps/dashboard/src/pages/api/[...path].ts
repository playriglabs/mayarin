/** Same-origin proxy from the dashboard to its Railway API. */

import type { APIRoute } from "astro";
import { getApiOrigin } from "@/lib/api/origin";
import { apiProxyHeaders } from "@/lib/api/proxy-headers";
import { apiProxyUrl } from "@/lib/api/proxy-url";

const WITHOUT_BODY = new Set(["GET", "HEAD"]);

export const ALL: APIRoute = async (context) => {
  const upstreamPath = context.url.pathname.slice("/api".length);
  let url: URL;
  try {
    url = apiProxyUrl(upstreamPath, context.url.search, getApiOrigin());
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers = apiProxyHeaders(context.request.headers);

  return fetch(url, {
    method: context.request.method,
    headers,
    redirect: "manual",
    ...(WITHOUT_BODY.has(context.request.method) ? {} : { body: context.request.body }),
  });
};
