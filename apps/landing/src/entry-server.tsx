import { renderToString } from "preact-render-to-string";
import { notFoundRoute, type Route, routes } from "./routes.tsx";

export type Prerendered = Readonly<{ file: string; html: string; route: Route }>;

/** Every route, rendered to the markup a crawler should receive on first byte. */
export function prerenderAll(): Prerendered[] {
  return [...routes, notFoundRoute].map((route) => ({
    file: route.file,
    html: renderToString(route.page()),
    route,
  }));
}
