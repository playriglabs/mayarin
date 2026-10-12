# `@mayarin/react`

A pay button and a headless hook that send a buyer to Mayarin's hosted checkout, from any React 18+
app. Full guide: <https://docs.mayarin.xyz/sdk/typescript/react>.

```bash
npm install @mayarin/react@next @mayarin/sdk@next
```

## Server mode — anything you sell

Your backend mints the checkout with its secret key (`@mayarin/sdk`) and returns the URL. The price
never leaves the server.

```tsx
import { PayButton } from "@mayarin/react";

<PayButton
  checkout={() => fetch("/api/pay", { method: "POST" }).then((r) => r.json())}
>
  Pay with crypto
</PayButton>;
```

The backend behind `/api/pay` — any handler that takes a `Request`, e.g. a Next.js route:

```ts
import { createMayarin } from "@mayarin/sdk";

const secretKey = process.env.MAYARIN_SECRET_KEY;
if (secretKey === undefined) throw new Error("MAYARIN_SECRET_KEY is required");

const mayarin = createMayarin({
  baseUrl: "https://api-testnet.mayarin.xyz",
  secretKey,
});

export async function POST(): Promise<Response> {
  const { url } = await mayarin.commerce.carts.checkout({
    currency: "SGD",
    lines: [
      {
        name: "Order #123",
        unitPrice: { amount: "25.00", asset: "SGD" },
        quantity: 1,
      },
    ],
    merchantReference: "order_123",
    metadata: { checkoutSuccessBaseUrl: "https://shop.example/thanks" },
  });
  return Response.json({ url });
}
```

`checkout` may resolve to the URL string or to any object with a `url` field.

## Browser mode — donations, tips, pay-what-you-want

No backend: the browser mints the checkout with a publishable key (`pk_...`). The amount is whatever
the browser sends, so for a sale check the paid amount against your order in the webhook.

```tsx
<PayButton
  publishableKey="pk_..."
  baseUrl="https://api-testnet.mayarin.xyz"
  amount="10.00"
  currency="SGD"
  merchantReference="donation_42"
  successUrl="https://shop.example/thanks"
/>
```

`useMayarinCheckout(options)` is the same flow without the button: wire its `redirect` to any
element.

Never pass a secret key (`sk_...`) to either — the SDK refuses it.
