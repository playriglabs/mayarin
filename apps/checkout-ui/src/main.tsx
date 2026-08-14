import { createRoot } from "react-dom/client";
import { InvoicePage } from "./InvoicePage.tsx";
import { LinkPage } from "./LinkPage.tsx";
import { PayPage } from "./PayPage.tsx";
import type { Bootstrap } from "./types.ts";
import "./styles.css";

/**
 * The entry point (#151).
 *
 * There is no client-side router. The API decides which page this URL is and
 * says so in the bootstrap it injected into the shell — the SPA's only job is
 * to render that decision. Navigation between pages is a full page load, which
 * hands the next URL back to the API for its own bootstrap.
 */
function App({ bootstrap }: { readonly bootstrap: Bootstrap }) {
  switch (bootstrap.page) {
    case "link":
      return <LinkPage bootstrap={bootstrap} />;
    case "pay":
      return <PayPage bootstrap={bootstrap} />;
    case "invoice":
      return <InvoicePage bootstrap={bootstrap} />;
  }
}

function titleFor(bootstrap: Bootstrap): string {
  switch (bootstrap.page) {
    case "link":
      return bootstrap.title;
    case "pay":
      return `Payment ${bootstrap.intentId}`;
    case "invoice":
      return `Invoice ${bootstrap.number ?? bootstrap.invoiceId}`;
  }
}

const root = document.getElementById("root");
const bootstrap = window.__BOOTSTRAP__;

if (root !== null && bootstrap !== undefined) {
  document.title = titleFor(bootstrap);
  createRoot(root).render(<App bootstrap={bootstrap} />);
} else if (root !== null) {
  // Served without a bootstrap: someone opened the raw shell. Nothing secret
  // to show and nothing to render — say so instead of a blank page.
  root.textContent = "Open this page from a payment link or invoice.";
}
