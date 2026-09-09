# x402 merchant example

A merchant that gates an API it hosts itself behind Mayarin's x402 rail (#269).
The whole gate is one middleware between Express and the handler: an unpaid
request is answered with the price in the standard `PAYMENT-REQUIRED` header, a
paid one is settled by Mayarin before the handler runs, and a replayed
signature is re-served without charging twice or running the handler again.

Two dependencies only — `express` and `@mayarin/sdk`. No Mayarin container, no
RPC client, no signing key: the merchant never touches the payer's asset.

## Run it against a local Mayarin

1. **Mayarin up** — `bun run db:up`, migrate, then `bun run dev` with
   `X402_ENABLED=true` (a funded `OPERATOR_PRIVATE_KEY` and `QUOTE_ENABLED=true`
   if you want the cross-asset rail too).

2. **Register the resource** — the one step that needs the merchant's secret
   key, minted on the dashboard (`/api-keys`):

   ```bash
   cd apps/x402-merchant
   MAYARIN_SECRET_KEY=mayarin_secret_… \
   PUBLIC_URL=http://localhost:8787 \
   X402_ACCEPTS='[
     {"chain":"base-sepolia","asset":"USDC","contract":"0x…","payTo":"0x…"}
   ]' \
   bun run register
   ```

   - `payTo` is the merchant's own address on a same-asset rail. On a
     cross-asset rail it must be the **operator** (derived from
     `OPERATOR_PRIVATE_KEY`) — see `scripts/e2e-x402.ts` for the full story.
   - `X402_PRICE_AMOUNT` (default `2000` minor units) and `X402_PRICE_ASSET`
     (default `USDC`) set the price.
   - The registered URL is `PUBLIC_URL` + `/premium` and must byte-match the
     URL an agent calls — the resource is identified by it.

3. **Serve**:

   ```bash
   MAYARIN_API_URL=http://localhost:3000 bun run dev
   ```

4. **Prove it** — unpaid, paid, replayed — from the repo root:

   ```bash
   # unpaid: 402 with PAYMENT-REQUIRED, nothing spent (--check stops here)
   bun run scripts/e2e-x402.ts --url http://localhost:8787/premium \
     --pay-to 0x… --chain base-sepolia --check

   # paid: one settlement, one completed intent
   bun run scripts/e2e-x402.ts --url http://localhost:8787/premium \
     --pay-to 0x… --chain base-sepolia

   # replay: identical signature twice, same body re-served,
   # still exactly one payment_intents row
   bun run scripts/e2e-x402.ts --url http://localhost:8787/premium \
     --pay-to 0x… --chain base-sepolia --repeat 2

   # cross-asset: the agent holds EURC, the merchant is paid USDC
   bun run scripts/e2e-x402.ts --url http://localhost:8787/premium \
     --chain base-sepolia --pay-with EURC
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
