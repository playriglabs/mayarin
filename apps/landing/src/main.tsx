import { hydrate, render } from "preact";
import { routeFor } from "./routes.tsx";

const root = document.getElementById("app");
const page = routeFor(window.location.pathname).page();

// The build ships this page already rendered, so the browser adopts that markup
// instead of throwing it away and painting the same thing again.
if (root) {
  if (root.firstChild) hydrate(page, root);
  else render(page, root);
}
