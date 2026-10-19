# Operator key in Turnkey (SEC-06)

The operator key pays gas for every deposit sweep and router call, settles x402
payments and funds swaps. It is the one key in the system that can move funds, so
on a mainnet chain it must not sit in a service's environment. `OPERATOR_SIGNER`
chooses where it lives:

| Value     | Key                                     | Allowed on a mainnet chain    |
| --------- | --------------------------------------- | ----------------------------- |
| `local`   | `OPERATOR_PRIVATE_KEY` in the process   | no, the service will not boot |
| `turnkey` | inside Turnkey, bounded by its policies | yes                           |

## What the policies enforce

`packages/providers/turnkey/src/policies.ts` writes four policies for a dedicated
**non-root** Turnkey user. Turnkey's engine does not apply to root users, and
denies a non-root user whatever is not explicitly allowed.

1. ALLOW transactions, but only to this deployment's contracts, on its chains, up
   to a value cap. Turnkey parses the transaction, so `eth.tx.to`, `chain_id` and
   `value` are checked by Turnkey, not by us.
2. ALLOW typed data, but only a Permit2 `PermitSingle` for Permit2, on those chains.
3. DENY every other raw payload.
4. DENY batched raw payloads.

Policy 3 is what makes policy 1 mean anything: a key that may sign an arbitrary
digest may sign any transaction hash. The account therefore never sends a bare
digest or a message, and refuses to (`createTurnkeyAccount`). Transactions go as
`sign_transaction` and typed data as an EIP-712 payload, the two requests Turnkey
can read.

Not expressible, and so not enforced: which function a transaction calls (that
needs a Smart Contract Interface uploaded per target, then
`eth.tx.function_signature`), and the `spender` inside a permit.

## Switching a deployment over

1. **Keep the address.** The deposit forwarders sweep to the operator, so the
   address is baked into each deployed `DepositForwarderFactory`. A different
   address means a new factory (see the rotation section of `runbooks.md`).
   Import the existing key into Turnkey, which preserves its address, rather than
   creating a new one. Check what else names the old address on chain before
   anything else changes.
2. In the Turnkey organization create a non-root user for the operator and an API
   key for it. It must not be the key in `TURNKEY_API_PUBLIC_KEY`; boot refuses
   the same key twice.
3. Print the policies and create them for that user:

   ```bash
   bun --env-file=.env run scripts/turnkey-operator.ts policies --user <user-uuid> \
     [--max-value-wei 0] [--extra <chain>:<router-address>]
   ```

4. Set, on core-api and chain-worker: `OPERATOR_SIGNER=turnkey`,
   `OPERATOR_ADDRESS`, `OPERATOR_TURNKEY_SIGN_WITH`,
   `OPERATOR_TURNKEY_API_PUBLIC_KEY`, `OPERATOR_TURNKEY_API_PRIVATE_KEY`, and
   delete `OPERATOR_PRIVATE_KEY`. Boot refuses both together.
5. Confirm the policies hold against your organization before real value:

   ```bash
   bun --env-file=.env run scripts/turnkey-operator.ts selftest --chain base-sepolia
   ```

   It signs (nothing is broadcast) a transaction to an allowed contract, which must
   succeed and recover to `OPERATOR_ADDRESS`, then a transaction to another
   address, one on another chain, and a raw digest, all of which must be refused.
   This is also how the request formats are checked: they follow Turnkey's
   documentation, and `selftest` is the first thing to run against the live
   organization.

6. Bound the exposure: keep only the gas and float the executor needs in the
   operator's address, and sweep the rest to the treasury Safe.

## Failure modes to know

- A policy refusal is an error from the signing call (`Turnkey did not sign the
transaction`), not a silent skip; the payment step retries as any provider error
  does. A policy that is too narrow shows up as every sweep failing, so run
  `selftest` after every policy change.
- The value cap defaults to 0. Raise it only if something sends native currency.
- A new contract (a swap router, a new token) must be added to the policy before
  the service uses it, or the transaction is refused. `--extra` covers routers
  the services reach by another route.
