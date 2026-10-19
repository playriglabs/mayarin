/**
 * The operator key's Turnkey policies, and a check that they hold (SEC-06).
 *
 *   # Print the policies for this deployment's contracts. Sends nothing.
 *   bun --env-file=.env run scripts/turnkey-operator.ts policies --user <uuid>
 *
 *   # Sign with the live key and confirm what is allowed is signed and what is
 *   # not is refused. Signs only; nothing is broadcast.
 *   bun --env-file=.env run scripts/turnkey-operator.ts selftest --chain base-sepolia
 *
 * `policies` reads the contracts from the same variables the services read
 * (PAYMENT_ROUTERS, DEPOSIT_FORWARDERS, CHAIN_ASSETS, UNISWAP_SWAP_ROUTERS). A
 * swap router the services reach by another route (0x, LiFi) is added with
 * `--extra <chain>:<address>`, once per router. The output is a JSON array of
 * Turnkey policies: create them for the operator's non-root user in the Turnkey
 * dashboard or CLI. `--user` is that user's id.
 *
 * `selftest` is how the request formats are confirmed against your organization:
 * it needs OPERATOR_SIGNER=turnkey and the OPERATOR_* variables, signs a
 * zero-value transaction to a contract the policy allows (must succeed and
 * recover to OPERATOR_ADDRESS), then a transaction to an address it does not and
 * a raw digest (both must be refused).
 */

import { evmChainIdOf, isEvmChainId } from "@mayarin/chain";
import { ApiKeyStamper, createTurnkeyAccount, operatorPolicies } from "@mayarin/provider-turnkey";
import { type Hex, keccak256, recoverTransactionAddress, type TransactionSerialized } from "viem";

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function args(name: string): string[] {
  return process.argv.flatMap((value, i) =>
    value === `--${name}` && process.argv[i + 1] !== undefined
      ? [process.argv[i + 1] as string]
      : [],
  );
}

function json<T>(name: string): T {
  return JSON.parse(process.env[name] ?? "{}") as T;
}

/** The contracts the operator is expected to call, per EVM chain id. */
function contractsFromEnv(): Record<number, string[]> {
  const byChain = new Map<number, Set<string>>();
  const add = (chain: string, address: string | undefined) => {
    if (address === undefined || !isEvmChainId(chain)) return;
    const id = Number(evmChainIdOf(chain));
    byChain.set(id, (byChain.get(id) ?? new Set()).add(address.toLowerCase()));
  };

  for (const [chain, router] of Object.entries(json<Record<string, string>>("PAYMENT_ROUTERS"))) {
    add(chain, router);
  }
  for (const [chain, factory] of Object.entries(
    json<Record<string, string>>("DEPOSIT_FORWARDERS"),
  )) {
    add(chain, factory);
  }
  for (const [chain, router] of Object.entries(
    json<Record<string, string>>("UNISWAP_SWAP_ROUTERS"),
  )) {
    add(chain, router);
  }
  // Tokens: the operator approves Permit2 on them and settles x402 transfers.
  for (const [chain, tokens] of Object.entries(
    json<Record<string, Record<string, string>>>("CHAIN_ASSETS"),
  )) {
    for (const address of Object.values(tokens)) add(chain, address);
  }
  for (const extra of args("extra")) {
    const [chain, address] = extra.split(":");
    if (chain === undefined || address === undefined)
      throw new Error(`--extra ${extra}: want chain:address`);
    add(chain, address);
  }
  return Object.fromEntries([...byChain].map(([id, set]) => [id, [...set]]));
}

function account() {
  const need = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value === "") throw new Error(`${name} is not set`);
    return value;
  };
  if (process.env.OPERATOR_SIGNER !== "turnkey") throw new Error("OPERATOR_SIGNER must be turnkey");
  return createTurnkeyAccount({
    organizationId: need("TURNKEY_ORGANIZATION_ID"),
    signWith: need("OPERATOR_TURNKEY_SIGN_WITH"),
    signerAddress: need("OPERATOR_ADDRESS") as Hex,
    stamper: new ApiKeyStamper({
      apiPublicKey: need("OPERATOR_TURNKEY_API_PUBLIC_KEY"),
      apiPrivateKey: need("OPERATOR_TURNKEY_API_PRIVATE_KEY"),
    }),
  });
}

async function selftest(): Promise<void> {
  const chain = arg("chain");
  if (chain === undefined || !isEvmChainId(chain))
    throw new Error("--chain <evm chain> is required");
  const chainId = Number(evmChainIdOf(chain));
  const allowed = contractsFromEnv()[chainId]?.[0];
  if (allowed === undefined) throw new Error(`No contract known on ${chain} to test with`);
  const operator = account();
  const base = {
    type: "eip1559" as const,
    chainId,
    nonce: 0,
    value: 0n,
    data: "0x" as const,
    gas: 100_000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
  };
  let failed = false;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : `  ${detail}`}`);
    failed ||= !ok;
  };

  try {
    const signed = (await operator.signTransaction({
      ...base,
      to: allowed as Hex,
    })) as TransactionSerialized;
    const recovered = await recoverTransactionAddress({ serializedTransaction: signed });
    check(
      "a transaction to an allowed contract is signed, by the operator's address",
      recovered.toLowerCase() === operator.address.toLowerCase(),
      `recovered ${recovered}`,
    );
  } catch (error) {
    check("a transaction to an allowed contract is signed", false, String(error));
  }

  const refused = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
      check(name, false, "Turnkey signed it");
    } catch {
      check(name, true);
    }
  };
  await refused("a transaction to an address outside the policy is refused", () =>
    operator.signTransaction({ ...base, to: "0x000000000000000000000000000000000000dEaD" }),
  );
  await refused("a transaction on a chain outside the policy is refused", () =>
    operator.signTransaction({ ...base, chainId: 999_999_999, to: allowed as Hex }),
  );
  await refused("a raw digest is refused", async () => {
    // Bypasses the account (which never sends one) to confirm the policy, not the
    // client, is what stops it.
    const { signDigest, ApiKeyStamper: Stamper } = await import("@mayarin/provider-turnkey");
    await signDigest(
      {
        organizationId: process.env.TURNKEY_ORGANIZATION_ID ?? "",
        signWith: process.env.OPERATOR_TURNKEY_SIGN_WITH ?? "",
        signerAddress: operator.address,
        stamper: new Stamper({
          apiPublicKey: process.env.OPERATOR_TURNKEY_API_PUBLIC_KEY ?? "",
          apiPrivateKey: process.env.OPERATOR_TURNKEY_API_PRIVATE_KEY ?? "",
        }),
      },
      keccak256("0x1234"),
    );
  });

  if (failed) {
    console.error("\nAt least one check failed; do not point production at this key.");
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

const command = process.argv[2];
if (command === "policies") {
  const policies = operatorPolicies({
    userId: arg("user") ?? "",
    contracts: contractsFromEnv(),
    maxValueWei: BigInt(arg("max-value-wei") ?? "0"),
    permit2: PERMIT2,
  });
  console.log(JSON.stringify(policies, null, 2));
} else if (command === "selftest") {
  await selftest();
} else {
  console.error("usage: turnkey-operator.ts policies --user <uuid> | selftest --chain <chain>");
  process.exit(2);
}
