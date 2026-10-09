[← Chain and settlement](./chain.md)

# Orca devnet TokenBadge request for official USDG

This is a ready-to-send request to Orca. It contains public deployment facts
only; no wallet secret or API credential is required.

## Request

Please create a TokenBadge on Orca devnet for the official Paxos USDG mint:

| Field                  | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| Cluster                | Solana devnet                                                         |
| Orca Whirlpool program | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`                         |
| Whirlpools config      | `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR`                        |
| USDG mint              | `4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7`                        |
| Intended pair          | Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`     |
| Intended use           | Payment test rail, exact-output quote and atomic USDG→USDC settlement |

The mint is the address published in the
[Paxos USDG test-network documentation](https://docs.paxos.com/guides/stablecoin/usdg/testnet).
Orca SDK `PoolUtil.isSupportedToken` returns `false`, and no TokenBadge account
currently exists for this mint under the devnet Whirlpools config. The expected
TokenBadge PDA is `Gv66oTBqPV37BNBWkspgoyVtFpezPS9WoMoSJ4jyKUgq`.

Observed Token-2022 mint extensions:

- `TransferFeeConfig` with a zero-basis-point, zero-maximum fee.
- `MetadataPointer` and `TokenMetadata`.
- `MintCloseAuthority`.
- `PermanentDelegate`.
- `ConfidentialTransferMint` and its confidential-fee extension.
- `TransferHook`; its current program id is the default/null public key, so no
  active hook CPI is executed, but the extension still makes the mint fail
  Orca's permissionless allowlist.

Mint authority: `8QQGLu3q8XfhV5PvSHojK6ypPNGxkw1xTmY8M68M4uAY`.
Freeze/update authority:
`DFWDTsWsyGgFLbVARTS92wHDKK2hwTUNk71uPM3mf16S`.

Requested outcome: initialize the TokenBadge PDA for this mint on the config
above, or confirm which extension/authority prevents approval. Once the badge is
present, Mayarin can create and seed the USDG/USDC Whirlpool without any other
Orca authority action.

## Local verification

Run the compatibility check against devnet, then verify that the badge exists
before provisioning a pool. Do not replace `CHAIN_ASSETS.USDG` with the official
mint until an exact-output quote and a complete PaymentRouter transaction both
succeed.

```sh
bun run --cwd packages/providers/solana check:official-usdg
```
