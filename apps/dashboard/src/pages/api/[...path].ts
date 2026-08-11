/** Same-origin proxy from the dashboard to its Railway API. */

import type { APIRoute } from "astro";
import { getApiOrigin } from "@/lib/api/client";

const WITHOUT_BODY = new Set(["GET", "HEAD"]);

export const ALL: APIRoute = async (context) => {
  const upstreamPath = context.url.pathname.slice("/api".length);
  const url = new URL(`${upstreamPath}${context.url.search}`, getApiOrigin(context));
  const headers = new Headers(context.request.headers);
  headers.delete("host");
  headers.delete("content-length");

  return fetch(url, {
    method: context.request.method,
    headers,
    redirect: "manual",
    ...(WITHOUT_BODY.has(context.request.method) ? {} : { body: context.request.body }),
  });
};
