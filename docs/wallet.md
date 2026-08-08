# Merchant wallets

Where a merchant is paid on-chain, and what this system knows about how that
address came to be theirs (#11).

## The claim

A merchant who has never held a wallet is **self-custodial from their first
payment**. Nobody else offers that: Helio is non-custodial but the merchant must
already have a wallet; Coinbase Commerce and BitPay solve onboarding by
custodying; Stripe pays out to a bank account and never meets the question.

The claim only counts if it is enforced rather than asserted, so it reduces to
two properties, both checkable on-chain:

1. **Mayarin is never the sole signer.** The Safe's owner set contains a
   merchant-controlled key from the moment the Safe exists.
2. **The merchant can leave.** Threshold 1 means they can remove Mayarin from
   the owner set without our cooperation. Executed, not asserted:
   `scripts/verify-safe-recovery.ts` does it on Base Sepolia with a key
   generated inside the script, so nothing Mayarin holds contributes.

## Two paths, side by side

|                                | Connect-existing         | Managed                                               |
| ------------------------------ | ------------------------ | ----------------------------------------------------- |
| Who owns the address           | the merchant already did | a Safe Mayarin deploys                                |
| Proof it is theirs             | they sign a challenge    | they are an owner of it                               |
| What Mayarin can sign for them | nothing                  | a transaction to that Safe, bounded by Turnkey policy |
| `provenance`                   | `linked`                 | `provisioned`                                         |

A merchant holds both at once if they like. Which one is actually paid is the
settlement address (#95), decided separately — and either way the order signer
refuses an address that is not a verified wallet belonging to that merchant.

## Proof of control

Linking records a claim; it does not make an address payable. Verification is a
signature, recovered and compared. The challenge binds merchant, chain, address,
nonce and expiry, and each closes a distinct replay: across merchants, across
chains, across a re-claim after unlinking, and across time. The challenge is
consumed by a conditional `UPDATE`, so two requests racing one signature cannot
both succeed. Every failure reads identically.

## Provisioning, and why it is shaped for a crash

Three effects have to happen — create the Turnkey sub-organization, deploy the
Safe, record it — and a crash between any two must leave the merchant with
**exactly one** wallet. Zero is a failure somebody notices. Two is a second
address a payer might be told to pay, and nobody notices until the money is in
the wrong one.

So the record is written _before_ the deployment, addressed by a prediction:

1. `createManagedSigner` — the sub-organization and its key.
2. `predictAddress` — CREATE2 over the signer set and a salt derived from
   merchant and chain. The same answer on every attempt.
3. persist the row, unverified.
4. `deploy` — adopts whatever is already at the address.
5. mark verified, which is what makes it payable.

A crash before step 3 orphans a sub-organization and deploys nothing; the retry
makes one wallet. A crash after step 3 resumes onto the same signer and the same
address. A partial unique index (`merchant_id`, `chain`) over provisioned rows
makes two concurrent requests resolve to one wallet rather than two Safes.

Provisioning requires a **verified linked wallet** first — that address is the
merchant's owner. Nothing generates a key on a merchant's behalf: a key Mayarin
generated is a key Mayarin saw, and a signer set built from one is custody
wearing a merchant's name. So provisioning is one authenticated call after the
merchant proves control of one address, which is the earliest point a
non-custodial signer set can be assembled at all.

## Where the custody boundary sits

The `WalletProvider` port has no method that takes bytes and returns a
signature. The backend proposes a movement from a closed union and the provider
decides; the refusal is structural, because a convention is what gets bypassed
at 2am by someone not thinking about custody.

Inside Turnkey, **policies do not apply to root users**. A sub-organization
needs a root user, and that is Mayarin's API key, so a policy written against it
would be decoration. Each sub-organization therefore holds two Mayarin
identities:

- the **root** key, which creates the sub-organization and is a break-glass
  credential;
- a **non-root signer** user, default-denied by Turnkey and admitted only by one
  policy: sign transactions addressed to _that merchant's Safe_.

Boot refuses `TURNKEY_SIGNER_API_PUBLIC_KEY` equal to the root key, since that
would quietly collapse the distinction the policy depends on.

Threshold 1 is deliberate. It means Mayarin can also act alone, bounded by that
policy rather than by the contract. Threshold 2 would put the boundary in the
contract — and would also mean a merchant cannot withdraw or leave without
Mayarin co-signing, which fails the self-custody test the whole design is for.

## Fees and payouts never overlap

A fee recipient that is also a payout destination pays a merchant twice and
shows one payment in the ledger. Both directions are closed:

- a merchant cannot link or be provisioned at a treasury address, refused when
  it is typed rather than at their first payment;
- a deployment whose `TREASURY_ADDRESS` is already somebody's merchant wallet
  **does not boot**. Nothing about that direction looks wrong at request time,
  so it can only be caught at startup.

## Configuration

`WALLET_PROVISIONING_ENABLED` is off by default and the whole feature is absent
when it is; the endpoint then refuses with a message rather than the deployment
carrying a provisioning path that fails at the first merchant. When on, boot
requires the RPC URL, the deployer key that pays deployment gas, and the four
Turnkey values. See `.env.example`.

## Verified on Base Sepolia

- Provisioning end to end — `scripts/verify-managed-provisioning.ts`: prediction
  equals deployment, owners `[merchant, turnkey]` at threshold 1, the non-root
  signer user and its policy read back from Turnkey, and a second run that
  adopts and deploys nothing.
- The exit — `scripts/verify-safe-recovery.ts`: owners go
  `[merchant, mayarin] → [merchant]` on a signature from the merchant key alone.
  Gas came from the operator key, which is not authority: a Safe cares who
  signed, not who paid.

## Not here

Gas abstraction (#9). A provisioned Safe starts empty and cannot pay to move its
own stablecoin, so `propose()` throws rather than approximating a movement it
cannot make. Receiving works today; withdrawing needs #9.
