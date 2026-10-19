# Origin authentication (SEC-13)

The generated Railway domain reaches the same service as the public hostname, but
skips Cloudflare's WAF, rate limits and bot policy. `ALLOWED_HOSTS` stops a
request that does not bother to send the right `Host`; it does not stop one that
does. `ORIGIN_AUTH_SECRET` does: both APIs answer **404** to any request that
does not carry `x-origin-secret` with that value, as they would a path they do
not have. `/health` is exempt, because the platform probes it directly.

Unset, the check is off. That is the default, so nothing changes until you do the
steps below, **in this order**. Setting it on the services before the edge sends
it makes every request a 404.

## What sends the header

| Caller                                     | How it gets the header                                       |
| ------------------------------------------ | ------------------------------------------------------------ |
| Browsers and API clients, via Cloudflare   | A Cloudflare Transform Rule adds it (step 2)                 |
| The pay proxy Worker (`pay-testnet`)       | The Worker secret `ORIGIN_AUTH_SECRET`; sets it on every hop |
| The dashboard Pages app (SSR and `/api/*`) | The Pages secret `ORIGIN_AUTH_SECRET`; sets it on every call |

A visitor's own `x-origin-secret` is never forwarded by either of ours.

## Rollout

1. Generate a value (`openssl rand -base64 48`); keep it in your password manager.
2. **Edge first.**
   - Cloudflare, for each API hostname (`api-*`, `api-merchant-*`): Rules, Transform
     Rules, Modify Request Header, Set static `x-origin-secret` to the value. Scope
     it to the API hostnames only.
   - Pay proxy: `wrangler secret put ORIGIN_AUTH_SECRET` in `apps/pay-proxy`.
   - Dashboard: set `ORIGIN_AUTH_SECRET` as a secret on the Pages project.
   - Redeploy the two Cloudflare apps (`deploy:testnet --only pay,dashboard`).
3. Confirm the edge sends it: with the services still unset nothing changes, so
   check by making the services log, or by step 4 on a staging copy.
4. **Then the services.** Set `ORIGIN_AUTH_SECRET` on core-api and dashboard-api
   (same value) and redeploy.
5. Verify both directions:

   ```bash
   # Through Cloudflare: works.
   curl -s -o /dev/null -w '%{http_code}\n' https://api-testnet.mayarin.xyz/v1/health
   # Straight at the Railway domain: 404, and the same for a request that guesses the Host.
   curl -s -o /dev/null -w '%{http_code}\n' https://<service>.up.railway.app/v1/payments/x
   curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: api-testnet.mayarin.xyz' https://<service>.up.railway.app/v1/payments/x
   ```

   `/health` stays reachable on the Railway domain for the platform's probe.

To rotate it: set the new value at the edge **and** on the services in the same
change window; a request carrying the old one is a 404 the moment a service has the
new one. There is no overlap period.

## What this is not

A bearer secret in a header, not mTLS: whoever reads it (anyone who can read a
service's environment, or a Cloudflare rule) can send it. It closes the direct
path for anyone who does not have it, which is the gap. Removing the public
Railway domain, or putting the origin behind Cloudflare Tunnel, is stronger and is
still worth doing; this makes it unnecessary to do so under time pressure.
