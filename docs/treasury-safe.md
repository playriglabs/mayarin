# Treasury as a threshold Safe (SEC-06)

`TREASURY_ADDRESS` receives fees and swap output above `minOut`. One key there is
one point of compromise. On mainnet it should be a Safe that needs several
independent people to move anything.

## Deploy

```bash
# Predict the address and check the chain's Safe contracts. Sends nothing.
bun --env-file=.env run scripts/deploy-treasury-safe.ts --chain base \
  --owner 0x… --owner 0x… --owner 0x… --threshold 2 --salt treasury-1

# Deploy it. SAFE_DEPLOYER_PRIVATE_KEY is any funded key; it has no authority
# over the Safe afterwards.
… --execute
```

It is deterministic (canonical Safe 1.4.1, `createProxyWithNonce`), so the address
is known before anything is sent and a second run recognises the Safe as already
there. After a deploy it reads the owners and threshold back from the chain and
fails unless they are exactly what was asked for.

It refuses:

- a threshold under 2, or above the number of owners;
- a duplicate, zero or malformed owner;
- any address of a key this environment holds: `OPERATOR_PRIVATE_KEY`,
  `QUOTE_SIGNER_PRIVATE_KEY`, `OPERATOR_ADDRESS`, `TURNKEY_SIGNER_ADDRESS`;
- a chain whose Safe contracts are not the canonical ones.

## Choosing the owners

People's keys, on hardware wallets, held by people who would not be fooled by the
same message at the same time. 2-of-3 is the least that is a multisig; 3-of-5 is
the usual next step once there are enough people. The operator and any key a
service holds are never owners: a signer set that includes a hot key is only as
safe as the hot key. A Safe has no timelock of its own; changing owners or the
threshold is itself a transaction the owners approve.

## Switching `TREASURY_ADDRESS`

1. Deploy the Safe on every chain the deployment runs on. The same owners,
   threshold and salt give the same address on each EVM chain that has the canonical
   Safe contracts.
2. Send a small amount from the Safe on testnet first, with the full threshold
   approving, to confirm the owners can actually sign (Safe{Wallet} does not list
   every testnet; the Safe's own transaction service or a signed `execTransaction`
   works wherever it is not).
3. Set `TREASURY_ADDRESS` on core-api and chain-worker and redeploy.
4. Move any balance from the old address.

`TREASURY_ADDRESS` is a redirect of fees if it is writable by whoever can change a
service's environment; keep that access narrow and review the diff of every change
to it.

## What this does not cover

The operator's float is a hot wallet by design. Bound it (keep only gas and the
working float, sweep the rest to this Safe) and alert when it exceeds that; see
`operator-signing.md`. The merchant settlement Safes are provisioned separately by
the wallet provider and are single-owner by the merchant's choice.
