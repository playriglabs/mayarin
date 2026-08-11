# `@mayarin/sdk`

The TypeScript client for merchant commerce, payments, QR helpers, and webhook verification.

## Create a payable IDR link

```ts
import { createMayarin } from "@mayarin/sdk";

const secretKey = process.env.MAYARIN_SECRET_KEY;
if (secretKey === undefined) throw new Error("MAYARIN_SECRET_KEY is required");

const mayarin = createMayarin({
  baseUrl: "https://api.mayarin.xyz",
  secretKey,
});

const link = await mayarin.commerce.paymentLinks.create({
  kind: "fixed",
  merchant: {
    id: "merchant_123",
    name: "Toko Melati",
    city: "Jakarta",
    countryCode: "ID",
  },
  amount: { amount: "50000.00", asset: "IDR" },
});

console.log(link.url);
```

Writes receive an idempotency key automatically. Pass `{ idempotencyKey: "order-4711" }` as the
method's final argument when the key must match an identifier in your own system.
