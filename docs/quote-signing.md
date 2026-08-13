# Quote-signing key custody

The quote-signing key is a custody-adjacent trust root. It does not hold funds,
but whoever holds it can authorize settlement amounts: `PaymentRouter` verifies
an EIP-712 `Order` against its `signer` role and then moves value on the strength
of that signature alone. A stolen key does not let an attacker drain the
contract — the contract only ever pays `minOut − fee` to the `merchantSafe` named
in the signed order — but it does let them sign orders naming a `merchantSafe`
they control, against payers willing to pay. Treat it as production key
material, not as a service credential.

RFC [#6](https://github.com/playriglabs/mayarin/issues/6), sub-issue
[#41](https://github.com/playriglabs/mayarin/issues/41).

## Decision: signer per deployment tier

All implementations sit behind the same `OrderSigner` port:

- Local and testnet use `LocalOrderSigner` with a dedicated disposable test key.
  The composition root refuses it when any configured `PaymentRouter` is on a
  mainnet chain.
- Mainnet uses `AwsKmsOrderSigner` with an `ECC_SECG_P256K1` asymmetric signing
  key. The private key never enters Railway; IAM grants only `kms:Sign`.
- Turnkey remains available for managed-wallet operations and as an optional
  order signer, but payment throughput no longer depends on its signature quota.

Operational alternatives:

| Option               | Why not                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Google Cloud KMS** | Also supports secp256k1 and can implement the same port. AWS KMS ships first; do not configure two production signers for one router.                        |
| **Dedicated HSM**    | Strongest isolation, operationally heaviest. Provisioning plus PKCS#11, with no managed rotation or policy layer. The right answer at a scale we are not at. |

AWS KMS is deliberately only the order-signing trust root. Merchant wallet
custody may still use Turnkey; those workloads have different policies and
should not force every payment confirmation through the same quota.

## What the signer sees

The adapter computes the EIP-712 digest locally and sends 32 opaque bytes. AWS
KMS receives it as `MessageType=DIGEST`; Turnkey uses
`HASH_FUNCTION_NO_OP`. Neither provider learns the order's contents, and the
digest is not hashed a second time.

Two distinct keys are involved, and conflating them is the easy mistake:

- The **API key** (P-256) authenticates the caller. Every request body is signed
  into an `X-Stamp` header, so a stolen header cannot be replayed against a
  different body. Held by `ApiKeyStamper`.
- The **signing key** (secp256k1) signs orders and never leaves the enclave.

## Rotation

Rotation is a two-sided operation: the backend must start signing with the new
key at the same time the contract starts accepting it. The contract side is
timelocked, so the order is fixed.

1. Create the new secp256k1 signing key in the selected provider. Note its
   Ethereum address.
2. Schedule `setSigner(newAddress)` on the `PaymentRouter` through the
   `TimelockController`, with multisig approval. **48h delay** — see the
   PaymentRouter README's admin model.
3. Wait out the delay. Existing orders keep verifying against the old key; the
   contract still holds it.
4. Execute the timelock operation.
5. Cut the backend over to the new key.

**No dual-validity window is needed on-chain**, and this is the part worth
understanding: the contract holds exactly one `signer` at a time, so between
steps 4 and 5 any order signed by the old key is rejected. That gap is bounded by
the lock TTL — orders outlive their signature by at most that long, and an
expired lock cannot become an order (`assembleOrder` refuses). Keep the cutover
inside a TTL of the timelock execution and no payment is caught mid-flight.

Rotate on: suspected compromise, personnel change with key access, or the
scheduled interval the policy sets. Compromise skips the schedule — pause the
router (instant, `GUARDIAN_ROLE`) first, then rotate at leisure. Pause cannot
move funds, so it is safe to reach for.

## Multisig

The multisig governs the timelock as proposer and executor. It does **not** hold
the signing key. Two separate approvals therefore protect the fund-adjacent
surface:

- IAM or the custody provider's policy engine gates each individual signature.
- The multisig plus the 48h timelock gates _which key the contract trusts at all_.

A compromise of either alone is recoverable. Signer compromise is caught by
rotating through the timelock; multisig compromise cannot redirect funds
(`test_config_changes_move_no_funds`) and gives the guardian a full day-plus to
cancel a malicious `setSigner`.

## Development

`LocalOrderSigner` (`@mayarin/provider-evm`) holds a private key in process and
signs with viem. It exists so the quote path runs end to end without custody
provider credentials. It is allowed for local development and testnet routers
only. Anything that can read the process can authorize settlement amounts, so
the composition root refuses it whenever a mainnet router is configured.

## Tests

- `packages/providers/turnkey/test/adapter.test.ts` — the signature Turnkey's
  `r`/`s`/`v` assembles into recovers to the signing key; the payload is sent
  unhashed; a pending activity fails loudly rather than returning a bad
  signature; the recovery id is lifted into Ethereum's 27/28.
- `packages/providers/evm/test/order-signer.test.ts` — the signed digest is
  byte-for-byte the one pinned in `vectors/order-hash.json`, the same fixture
  `PaymentRouter.t.sol` re-derives from `OrderHash.sol`. A domain or field drift
  fails here, not on-chain.
- `packages/providers/evm/test/aws-kms-order-signer.test.ts` — a DER signature
  returned by KMS is normalized and converted to an Ethereum signature that
  recovers to the configured signer address.
