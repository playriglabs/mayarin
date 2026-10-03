import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { CheckoutOptions } from "./checkout.ts";
import { type CheckoutCallbacks, useMayarinCheckout } from "./use-mayarin-checkout.ts";

type ButtonAttributes = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "onError" | "type"
>;

export type PayButtonProps = CheckoutOptions &
  CheckoutCallbacks &
  ButtonAttributes & {
    /**
     * Anything to render inside the button — text, an icon, a whole layout.
     * A function receives `{ loading }` to show its own busy state.
     * Defaults to "Pay with crypto".
     */
    readonly children?: ReactNode | ((state: { readonly loading: boolean }) => ReactNode);
  };

/** Every prop the checkout reads. The rest go on the `<button>` untouched. */
const CHECKOUT_PROPS: ReadonlySet<string> = new Set([
  "checkout",
  "publishableKey",
  "baseUrl",
  "amount",
  "currency",
  "name",
  "quantity",
  "merchantReference",
  "successUrl",
  "metadata",
  "onRedirect",
  "onError",
  "children",
]);

function buttonAttributes(props: PayButtonProps): ButtonAttributes {
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !CHECKOUT_PROPS.has(key)),
  ) as ButtonAttributes;
}

/**
 * A button that sends the buyer to Mayarin's hosted checkout.
 *
 * Unstyled on purpose: pass `className` or `style` and it looks like the rest
 * of your page. It never submits a surrounding form.
 */
export function PayButton(props: PayButtonProps) {
  const { redirect, loading } = useMayarinCheckout(props);
  const { children = "Pay with crypto" } = props;
  const attributes = buttonAttributes(props);

  return (
    <button
      {...attributes}
      type="button"
      disabled={attributes.disabled === true || loading}
      aria-busy={loading}
      onClick={() => void redirect()}
    >
      {typeof children === "function" ? children({ loading }) : children}
    </button>
  );
}
