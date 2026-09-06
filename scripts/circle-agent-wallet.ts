/**
 * The x402 payer, as a Circle Agent Stack agent wallet (RFC #208).
 *
 * The claim the Arc submission makes is that Mayarin never holds the payer's
 * key. `PAYER_PRIVATE_KEY` does not test that claim: the process that builds
 * the payment also signs it, so the separation is an assertion about code
 * rather than about custody. A Circle agent wallet does test it — the key is
 * held in Circle's MPC custody, the CLI holds a session against it, and this
 * process only ever sees a signature come back.
 *
 * The payer signs an EIP-3009 `transferWithAuthorization` and never broadcasts,
 * so the agent wallet needs no gas and Circle's gas sponsorship is not involved.
 *
 * ## What is not demonstrable on Arc
 *
 * `circle wallet limit set` — the Circle-enforced spending policy — takes a
 * **mainnet** chain, and Circle lists Arc on **testnet only**. So the policy
 * half of the acceptance criterion cannot be shown on Arc by any arrangement of
 * this code, and a `--max-amount` ceiling checked here would be Mayarin
 * refusing its own payment, which proves nothing about Circle. What this module
 * does instead is stay out of the way: when the CLI refuses — for a policy, a
 * missing session, or an unaccepted licence — the refusal is surfaced verbatim
 * and nothing is retried.
 *
 * ## Prerequisites
 *
 * 1. `npm install -g @circle-fin/cli` (Node 20.18.2+), or point `CIRCLE_CLI` at
 *    the binary.
 * 2. `circle wallet login <email> --testnet` — the session lasts 28 days and is
 *    stored separately from the mainnet one. Scripted logins are two-step:
 *    `--init` returns a request id, then `--request <id> --otp <code>`.
 * 3. Fund the wallet with Arc testnet USDC and read its address from
 *    `circle wallet list --chain ARC-TESTNET --output json`.
 * 4. Export `CIRCLE_AGENT_WALLET=0x…` and run the x402 script with
 *    `--payer circle`.
 */
import type { ChainId } from "@mayarin/chain";
import type { Eip712Domain } from "@mayarin/x402";
import { TRANSFER_WITH_AUTHORIZATION_TYPES } from "@mayarin/x402";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Where the key that signs the authorization lives. Recorded as evidence. */
export type PayerCustody = "local-key" | "circle-agent-wallet";

/** The one struct an x402 `exact` payer ever signs. */
export interface TransferAuthorization {
  readonly from: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly validAfter: bigint;
  readonly validBefore: bigint;
  readonly nonce: Hex;
}

export interface X402Payer {
  readonly address: Address;
  readonly custody: PayerCustody;
  signTransferAuthorization(domain: Eip712Domain, message: TransferAuthorization): Promise<Hex>;
}

/**
 * Circle's own name for each chain, which is not Mayarin's.
 *
 * Only the chains this repository has a reason to pay from are listed; the CLI
 * is the authority, so `circle blockchain list` settles any addition. Arc is
 * testnet-only in Circle's list, which is the whole reason the policy half of
 * #208 is blocked rather than merely unfinished.
 */
const CIRCLE_CHAINS: Partial<Record<ChainId, string>> = {
  "arc-testnet": "ARC-TESTNET",
  base: "BASE",
  "base-sepolia": "BASE-SEPOLIA",
};

export function circleChainOf(chain: ChainId): string {
  const named = CIRCLE_CHAINS[chain];
  if (!named) {
    throw new Error(
      `Circle agent wallets do not cover ${chain} here. Check \`circle blockchain list\` and add it to CIRCLE_CHAINS.`,
    );
  }
  return named;
}

/**
 * The EIP-712 payload as the CLI takes it: one JSON string, numbers as decimal
 * strings, and `EIP712Domain` spelled out. viem derives that entry from the
 * domain it is handed; a raw signer has nothing to derive it from, and a
 * missing entry changes the digest rather than raising an error.
 */
export function typedDataFor(domain: Eip712Domain, message: TransferAuthorization): string {
  return JSON.stringify({
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...TRANSFER_WITH_AUTHORIZATION_TYPES,
    },
    primaryType: "TransferWithAuthorization",
    domain,
    message: {
      from: message.from,
      to: message.to,
      value: message.value.toString(),
      validAfter: message.validAfter.toString(),
      validBefore: message.validBefore.toString(),
      nonce: message.nonce,
    },
  });
}

/**
 * The signature out of whatever the CLI printed around it.
 *
 * `--quiet` prints the signature alone, but a licence banner or an update
 * notice shares the stream, so the value is matched rather than assumed to be
 * the whole output. 65 bytes exactly: a shorter hex string is some other field.
 */
export function signatureFrom(output: string): Hex {
  const found = output.match(/0x[\da-f]{130}\b/i);
  if (!found) {
    throw new Error(`circle wallet sign returned no signature:\n${output.trim()}`);
  }
  return found[0] as Hex;
}

/** The payer this process holds the key for. */
export function localKeyPayer(key: Hex): X402Payer {
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    custody: "local-key",
    signTransferAuthorization: (domain, message) =>
      account.signTypedData({
        domain: { ...domain, verifyingContract: domain.verifyingContract as Address },
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
      }),
  };
}

/** The payer Circle holds the key for, reached through the CLI. */
export function circleAgentWalletPayer(address: Address, chain: ChainId): X402Payer {
  const binary = process.env.CIRCLE_CLI ?? "circle";
  const circleChain = circleChainOf(chain);
  return {
    address,
    custody: "circle-agent-wallet",
    signTransferAuthorization: async (domain, message) => {
      if (message.from.toLowerCase() !== address.toLowerCase()) {
        throw new Error("The authorization names a payer other than the agent wallet");
      }
      const child = Bun.spawn(
        [
          binary,
          "wallet",
          "sign",
          "typed-data",
          typedDataFor(domain, message),
          "--address",
          address,
          "--chain",
          circleChain,
          "--quiet",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [out, error, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0) {
        // A refusal is the interesting outcome, so it is reported rather than
        // wrapped: a spending policy, an expired session and an unaccepted
        // licence all arrive here, and they are not the same problem.
        throw new Error(
          `circle wallet sign typed-data exited ${exitCode} on ${circleChain}:\n${(error || out).trim()}`,
        );
      }
      return signatureFrom(out);
    },
  };
}
