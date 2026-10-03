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

## Browser mode — donations, tips, pay-what-you-want

No backend: the browser mints the checkout with a publishable key (`pk_...`). The amount is whatever
the browser sends, so for a sale check the paid amount against your order in the webhook.

```tsx
<PayButton
  publishableKey="pk_..."
  baseUrl="https://api-testnet.mayarin.xyz"
  amount="150000.00"
  currency="IDR"
  merchantReference="donation_42"
  successUrl="https://shop.example/thanks"
/>
```

`useMayarinCheckout(options)` is the same flow without the button: wire its `redirect` to any
element.

Never pass a secret key (`sk_...`) to either — the SDK refuses it.
