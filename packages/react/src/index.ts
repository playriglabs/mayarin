/**
 * `@mayarin/react` — a pay button that sends the buyer to Mayarin's hosted
 * checkout, with no product catalog on the dashboard. See `docs/embed.md`.
 */

export {
  type BrowserCheckout,
  type CartBody,
  type CheckoutOptions,
  type CheckoutUrl,
  cartBody,
  resolveCheckoutUrl,
  type ServerCheckout,
} from "./checkout.ts";
export { PayButton, type PayButtonProps } from "./pay-button.tsx";
export {
  type CheckoutCallbacks,
  type MayarinCheckout,
  useMayarinCheckout,
} from "./use-mayarin-checkout.ts";
