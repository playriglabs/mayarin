import type { VNode } from "preact";
import { BrandKit } from "./pages/brand-kit.tsx";
import { Landing } from "./pages/landing.tsx";
import { NotFound } from "./pages/not-found.tsx";

export const SITE_URL = "https://mayarin.xyz";

export type RouteMeta = Readonly<{
  title: string;
  description: string;
  /** Absolute canonical URL; omitted for pages that should not be indexed. */
  canonical?: string;
}>;

export type Route = Readonly<{
  path: string;
  page: () => VNode;
  meta: RouteMeta;
  /** Where the prerendered HTML is written, relative to the build output. */
  file: string;
}>;

/**
 * One table, used by both entries: the browser picks a page from it at runtime,
 * and the build renders every one of them to static HTML. A route that is only
 * in one of the two is a route that either 404s in production or ships empty to
 * a crawler, so there is deliberately no second list.
 */
export const routes: readonly Route[] = [
  {
    path: "/",
    page: () => <Landing />,
    file: "index.html",
    meta: {
      title: "Mayarin — A world of ways to pay",
      description:
        "Accept crypto, price in your local currency, and get paid in stablecoins. Explore Mayarin checkout, payment links, invoices, and your payment workspace.",
      canonical: `${SITE_URL}/`,
    },
  },
  {
    path: "/brand-kit",
    page: () => <BrandKit />,
    file: "brand-kit/index.html",
    meta: {
      title: "Mayarin — Brand Kit",
      description:
        "Download the Mayarin brand marks and wordmarks for product, communications and partner surfaces.",
      canonical: `${SITE_URL}/brand-kit`,
    },
  },
];

export const notFoundRoute: Route = {
  path: "/404",
  page: () => <NotFound />,
  file: "404.html",
  meta: {
    title: "Page not found — Mayarin",
    description: "The Mayarin page you requested could not be found.",
  },
};

/** Trailing slashes are noise; "/brand-kit/" and "/brand-kit" are one page. */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function routeFor(pathname: string): Route {
  return routes.find((route) => route.path === normalizePath(pathname)) ?? notFoundRoute;
}
