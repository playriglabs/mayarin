import type { InvoiceBootstrap } from "./features/invoice/types.ts";
import type { LinkBootstrap } from "./features/link/types.ts";
import type { PayBootstrap } from "./features/pay/types.ts";

/**
 * The bootstrap contract (#151).
 *
 * The API injects one of these into the shell as `window.__BOOTSTRAP__`, so the
 * page paints from data it already has — no fetch, no spinner. Each feature owns
 * the shape of its own page; this is only the union the entry point switches on.
 */
export type Bootstrap = LinkBootstrap | PayBootstrap | InvoiceBootstrap;

declare global {
  interface Window {
    __BOOTSTRAP__?: Bootstrap;
  }
}
