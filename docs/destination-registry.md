# Settlement destination registry (SEC-06)

`PaymentRouter` pays whatever `Order.merchantSafe` the quote signer signs. Without
a registry, a compromised signer key redirects any payment to its own address.
With one, it cannot: settlement must go to a Safe a **different** key registered.
Redirecting money then takes both keys, which live in different custody with
different policies.

## What the contract does

| Role / call                         | Who                                  | Delay             |
| ----------------------------------- | ------------------------------------ | ----------------- |
| `registerMerchantSafe(safe)`        | `REGISTRAR_ROLE`                     | none              |
| `revokeMerchantSafe(safe)`          | guardian or timelock (not registrar) | none (like pause) |
| `reinstateMerchantSafe(safe)`       | timelock (`CONFIG_ROLE`)             | the timelock's    |
| `setMerchantRegistryEnforced(bool)` | timelock                             | the timelock's    |
| `grantRole(REGISTRAR_ROLE, key)`    | timelock (`DEFAULT_ADMIN_ROLE`)      | the timelock's    |

- Enforcement is **off at deploy**. A new router is backfilled first, then enforced:
  turning it on before the merchants are registered reverts every payment.
- A **revoked** destination cannot be registered again by the registrar. A
  compromised-then-revoked address is not one key away from live; only the timelock
  reinstates it.
- The registrar cannot revoke. The key that adds destinations is not the one that
  decides which are bad.
- Nothing here moves funds. The router still has no path that redirects them.

Tested in `test/MerchantRegistry.t.sol`, including a fuzz of the invariant (an
enforced router pays only registered destinations) and both governance steps
through a real `TimelockController`.

## Rolling it out on a chain

1. Deploy the router (this build; the constructor is unchanged). Enforcement is off,
   so it behaves as before.
2. Pick the registrar key, **not** the quote signer. Grant it through the timelock:
   `REGISTRAR=0x… forge script scripts/ConfigureMerchantRegistry.s.sol:ConfigureMerchantRegistry …`
3. Register every merchant's destination:

   ```bash
   bun --env-file=.env run scripts/register-merchant-safe.ts --chain base --from-db          # what is missing
   REGISTRAR_PRIVATE_KEY=0x… bun --env-file=.env run scripts/register-merchant-safe.ts --chain base --from-db --execute
   ```

   `--from-db` collects every merchant's settlement address and every managed
   wallet on that chain. It skips what is registered and reports what was revoked.

4. Enforce, through the timelock: `ENFORCE=true forge script scripts/ConfigureMerchantRegistry.s.sol:ConfigureMerchantRegistry …`
5. From then on a new merchant is not payable until registered.

## What the API does

Before it signs an order, the contract planner asks the chain's router whether it
will pay the destination. If the router enforces a registry and the Safe is not in
it, the lock is refused with a reason (`…is not registered on the base PaymentRouter…`)
instead of reverting on chain at the payer's expense. A router from before the
registry has no such function and reads as not enforcing; an RPC that is down is an
error, never a pass. The enforcement answer is cached for a minute.

## What it does not cover, and costs

- **Escrow.** An escrowed order settles to a per-payment vault address, which is
  not a registered Safe, so an enforcing router refuses it. Do not enforce on a
  chain that offers buyer protection until the registry can recognise a registered
  factory's vaults.
- **New merchants.** Signup provisions a Safe automatically. With enforcement on,
  that Safe must be registered before its first payment. That step is a script today
  and should become part of provisioning (a registrar-key transaction after the Safe
  is deployed); until then it is a manual step per merchant.
- **Registrar custody.** The registrar is a hot key that registers addresses it
  cannot judge. Hold it in Turnkey with a policy allowing only `registerMerchantSafe`
  on the router (`eth.tx.to` the router, a small value cap), separate from the
  operator and quote-signer keys. A compromised registrar alone cannot redirect a
  payment: it still needs a signed order.
- **A compromised signer can still move a payment between two registered merchants.**
  The registry bounds where money can go, not who it was meant for.
