# x402 merchant example

A merchant that gates an API it hosts itself behind Mayarin's x402 rail (#269).
The whole gate is one middleware between Express and the handler: an unpaid
request is answered with the price in the standard `PAYMENT-REQUIRED` header, a
paid one is settled by Mayarin before the handler runs, and a replayed
signature is re-served without charging twice or running the handler again.

Two dependencies only — `express` and `@mayarin/sdk`. No Mayarin container, no
RPC client, no signing key: the merchant never touches the payer's asset.

## Run it against a local Mayarin

1. **Mayarin and its dashboard up** — `bun run db:up`, migrate, then
   `bun run dev:all` with
   `X402_ENABLED=true` (a funded `OPERATOR_PRIVATE_KEY` and `QUOTE_ENABLED=true`
   if you want the cross-asset rail too).

2. **Register the resource in the dashboard** — open **Agent endpoints** and
   create:

   - Endpoint: `premium-content`
   - URL: `http://localhost:8787/premium`
   - Price: `1.00 USD`
   - Rails: `Base Sepolia · USDC` and `Base Sepolia · EURC`

   The dashboard fills the token contract and payment recipient from Mayarin's
   configured assets, the merchant's verified settlement wallet, and the
   cross-asset operator. Neither address is copied into this app's environment.
   The gate asks Mayarin for the registered `premium-content` resource, while
   the payer calls its registered URL ending in `/premium`. Resource ids and URL
   paths are independent, so both values must match the app configuration.

3. **Serve**:

   ```bash
   bun run dev
   ```

   `MAYARIN_API_URL` defaults to `http://localhost:3000` and `PORT` defaults to
   `8787`; set either only when the local services run somewhere else.

4. **Prove it** — unpaid, paid, replayed — from the repo root:

   ```bash
   # unpaid: 402 with PAYMENT-REQUIRED, nothing spent (--check stops here)
   bun run scripts/e2e-x402.ts --url http://localhost:8787/premium \
     --pay-to 0x… --chain base-sepolia --check --ceiling 1.10

   # paid: one settlement, one completed intent
   bun run scripts/e2e-x402.ts --url http://localhost:8787/premium \
     --pay-to 0x… --chain base-sepolia --ceiling 1.10

   # replay: identical signature twice, same body re-served,
   # still exactly one payment_intents row
   bun run scripts/e2e-x402.ts --url http://localhost:8787/premium \
     --pay-to 0x… --chain base-sepolia --repeat 2 --ceiling 1.10

   # cross-asset: the agent holds EURC, the merchant is paid USDC
   bun run scripts/e2e-x402.ts --url http://localhost:8787/premium \
     --chain base-sepolia --pay-with EURC --ceiling 1.50
   ```

## Notes

- The gate is connect middleware over `node:http` types, so it also runs under
  Connect, a raw `node:http` server, or a Vite dev server — nothing here is
  Express-specific.
- The replay store is in memory and per-process: after a restart, a replayed
  signature reaches Mayarin, which refuses the spent nonce fail-closed. No
  second charge — but no re-serve either.
- The captured response is re-served in full, so gate content that streams or
  answers range requests.
