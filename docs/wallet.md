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

## Three paths, side by side

|                                | Connect-existing         | Passkey                          | Managed                                               |
| ------------------------------ | ------------------------ | -------------------------------- | ----------------------------------------------------- |
| Who owns the address           | the merchant already did | a key only their passkey can use | a Safe Mayarin deploys                                |
| Proof it is theirs             | they sign a challenge    | they sign a challenge            | they are an owner of it                               |
| What Mayarin can sign for them | nothing                  | nothing                          | a transaction to that Safe, bounded by Turnkey policy |
| `provenance`                   | `linked`                 | `passkey`                        | `provisioned`                                         |

A merchant holds several at once if they like. Which one is actually paid is the
settlement address — and either way the order signer refuses an address that is
not a verified wallet belonging to that merchant.

## The merchant who has no wallet

Provisioning needs a merchant-controlled signer, and connect-existing was the
only way to have one. So the merchant this product is for — the one who has
never held a wallet — was asked to acquire one, understand a seed phrase and keep
it safe before their first payment. "Merchants never connect MetaMask" was the
claim and it was not true.

The passkey path closes it. Turnkey creates a sub-organization whose **only root
user is the merchant's own WebAuthn credential** — no Mayarin API key, root or
signer, at `rootQuorumThreshold` 1 — holding one secp256k1 Ethereum account.
Mayarin's parent-organization key creates it and that is the last thing that key
can do there: creating a sub-organization does not make the parent a user of it,
so signing, adding an authenticator and exporting are all denied to Mayarin by
Turnkey rather than by this code remembering not to ask. The port has no method
that returns key material or a signature, and `TurnkeyMerchantKeyProvider` is a
separate class from the wallet provider so a future method that signs something
cannot land on the wrong side of that line.

The trust assumption moved rather than disappeared, and it is worth saying where
it went: it now rests on Turnkey's enclave honouring its own authorization model
— the same assumption the settlement path already makes about the same vendor.
What it does not rest on is Mayarin's own discipline.

**Creating a key is not proof of holding it.** A passkey wallet is recorded
unverified and becomes payable exactly like a linked address: the merchant's
browser signs the challenge with the new key, stamping the request to Turnkey
with the passkey, and this deployment recovers the signature. Skipping that would
be verifying Mayarin's own API call — and a key that turns out not to sign
becomes a Safe owner that cannot act, which is self-custody that is true in the
database and false on-chain. The chain being proved is passkey → Turnkey → key →
address, every link of it new, and the moment to find a broken one is before a
Safe is built on top.

So the journey is: sign up, create a passkey, sign one message, get a Safe you
already own. No wallet connected, no seed phrase, and no gas — creating the key
touches no chain, and receiving an ERC-20 costs the recipient nothing.

## Which address gets paid

`merchants.settlement_address` is what the merchant set, writable through the
settings API since #95. Unset falls back to **the managed wallet on the chain
being paid**, resolved on read (`SettlementAddressResolver`). A merchant handed a
Safe and left to discover that a settings field nobody mentioned was load-bearing
is a merchant whose first payment refuses to lock, and nothing about that state
looks wrong until money is meant to arrive.

Resolved on read rather than written as a default at provisioning time, because
`settlement_address` is one column for the whole merchant while a managed wallet
is per chain — writing chain A's Safe into it makes it the answer for chain B too
— and because a default that has been written down is indistinguishable from a
choice.

The fallback does not loosen anything: it is a verified wallet of that merchant
by construction, and it still goes through `WalletGuard` like any configured
value. An unverified or half-provisioned wallet is not a fallback, and neither is
one on another chain.

`GET /settings` reports both — `settlementAddress` is what the merchant chose,
`effectiveSettlementAddress` is where the money goes — and `canSettleOnChain`
reads the second. A merchant who has chosen nothing and holds a Safe can settle
perfectly well, and a screen deriving that from the chosen address alone would
send them looking for a setting that does not need changing. The resolver answers
both questions from one rule: `resolve` is `effective` plus a throw.

## Proof of control

Linking records a claim; it does not make an address payable. Verification is a
signature, recovered and compared. The challenge binds merchant, chain, address,
nonce and expiry, and each closes a distinct replay: across merchants, across
chains, across a re-claim after unlinking, and across time. The challenge is
consumed by a conditional `UPDATE`, so two requests racing one signature cannot
both succeed. Every failure reads identically.

A passkey wallet's sub-organization handle is stored as `key_ref`, separately
from the `provider_ref` a managed wallet records: the two mean opposite things —
one is the organization Mayarin is root of, the other the one Mayarin is not a
user of — and sharing a column would turn "whose organization is this" into a
question about which neighbouring columns happen to be null. The handle is not a
secret. Holding it without the authenticator does nothing, which is why the
merchant's browser is given it: it has to name the organization it signs in.

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

Provisioning requires a **verified merchant-held wallet** first — linked or
passkey; that address is the merchant's owner. What is refused is a signer set
built out of a key Mayarin could produce a signature for, which would be custody
wearing a merchant's name. So provisioning is one authenticated call after the
merchant proves control of one address, which is the earliest point a
non-custodial signer set can be assembled at all.

A merchant holding more than one — a linked address and a passkey key — gets the
oldest, address as the tiebreak. Repository order is not a promise, and a signer
that varied between attempts would derive a different address and deploy a second
Safe.

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

One flag covers both provider-backed paths — the passkey key and the managed
Safe. A deployment with the first and not the second would onboard merchants into
a key with no smart account to own, which is not a state worth being able to
configure. Creating the key needs only the parent organization and the API key
pair: no RPC, no deployer key, no Safe addresses.

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

**Gas abstraction (#9).** A provisioned Safe starts empty and cannot pay to move
its own stablecoin, so `propose()` throws rather than approximating a movement it
cannot make. Receiving works today; withdrawing needs #9.

**The browser half of the passkey path.** The API is complete — create the
credential, `POST /wallets/passkey`, challenge, verify — and the dashboard has no
wallet screen to drive it yet. Creating the credential and stamping the signing
request are `navigator.credentials` and a Turnkey browser stamper; the signature
that comes back goes through the same `/verify` a MetaMask signature does. Until
that screen exists the passkey path is reachable by an API client only.

**A second authenticator.** A merchant with one passkey and one device has one
way in. Turnkey's answer is adding an authenticator to the existing
sub-organization, which their current passkey has to authorize, so it is browser
work of the same kind. What a lost passkey does not do is strand the money: the
merchant's Safe still has Mayarin as an owner at threshold 1, bounded by the
policy to transactions addressed to that Safe.
