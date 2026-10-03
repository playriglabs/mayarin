# `@mayarin/sdk`

The TypeScript client for Mayarin commerce, payments, QR helpers, webhook verification,
and x402 gates. It is ESM-only and supports Node.js 20+, Bun, modern browsers, and edge runtimes
with the standard Fetch and Web Crypto APIs.

```bash
bun add @mayarin/sdk@next
# or: npm install @mayarin/sdk@next
```

## Create a payable IDR link

```ts
import { createMayarin } from "@mayarin/sdk";

const secretKey = process.env.MAYARIN_SECRET_KEY;
if (secretKey === undefined) throw new Error("MAYARIN_SECRET_KEY is required");

const mayarin = createMayarin({
  baseUrl: "https://api-testnet.mayarin.xyz",
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

## Entry points

- `@mayarin/sdk` — server client, webhook helpers, and framework-neutral x402 gate.
- `@mayarin/sdk/browser` — browser-safe catalog reads and cart checkout with a publishable key.
- `@mayarin/sdk/x402/connect` — Connect/Express/Node HTTP adapter for the x402 gate.

## Security

- The server and browser entry points are separated by types — browser config has no field for a
  secret key and its commerce surface has no merchant write methods — and by runtime checks:
  `createMayarin` throws in a browser and accepts only an `sk_` key; `createMayarinBrowser` accepts
  only a `pk_` key.
- `baseUrl` must be `https`. Plain `http` is accepted for `localhost`, `127.0.0.1` and `[::1]`
  only, because every request carries the key as a bearer token.
- Requests never follow a redirect, so the key is never forwarded to another host.
- `verifyWebhook` compares signatures in constant time, rejects timestamps outside a five-minute
  window, and throws on an empty secret. Verify the raw request body, before any JSON parsing.

Full documentation: [docs.mayarin.xyz/sdk/typescript](https://docs.mayarin.xyz/sdk/typescript).
