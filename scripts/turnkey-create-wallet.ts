/**
 * Creates a Company Wallet in the configured Turnkey organization (#41, #11).
 *
 * The signing key Turnkey holds is a different object from the API key that
 * authenticates the caller. Signup gives you the second; this creates the
 * first, and prints the two values `.env` is missing:
 *
 *   TURNKEY_SIGN_WITH        — what Turnkey signs with
 *   TURNKEY_SIGNER_ADDRESS   — the Ethereum address it signs as
 *
 * For a wallet account both are the account's address: `signWith` tells Turnkey
 * which key, `signerAddress` tells our code what identity to claim for it.
 *
 * Read-only against your funds and additive against your organization — it
 * creates a key, it never moves anything. Reuses `ApiKeyStamper` rather than
 * re-implementing request signing, so a stamp that works here works in the
 * order signer too.
 *
 *   bun --env-file=.env run scripts/turnkey-create-wallet.ts [--name "..."]
 *   bun --env-file=.env run scripts/turnkey-create-wallet.ts --list
 *   bun --env-file=.env run scripts/turnkey-create-wallet.ts --verify
 *
 * `--verify` is the one that matters: a wallet existing is not evidence that it
 * can sign for us. It signs a throwaway EIP-712 payload through the same
 * adapter production uses and recovers the address, so a mismatch surfaces here
 * rather than on a merchant's payment.
 */

import {
  ApiKeyStamper,
  DEFAULT_TURNKEY_ENDPOINT,
  TurnkeyOrderSigner,
} from "@mayarin/provider-turnkey";
import { recoverTypedDataAddress } from "viem";

const organizationId = requireEnv("TURNKEY_ORGANIZATION_ID");
const stamper = new ApiKeyStamper({
  apiPublicKey: requireEnv("TURNKEY_API_PUBLIC_KEY"),
  apiPrivateKey: requireEnv("TURNKEY_API_PRIVATE_KEY"),
});

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const verifyOnly = args.includes("--verify");
const nameIndex = args.indexOf("--name");
const walletName =
  nameIndex === -1
    ? `mayarin-order-signer-${new Date().toISOString().slice(0, 10)}`
    : args[nameIndex + 1];

if (listOnly) {
  await listWallets();
} else if (verifyOnly) {
  await verifySigning();
} else {
  await createWallet(walletName ?? "mayarin-order-signer");
}

/** Signs a throwaway payload and recovers it, through the production adapter. */
async function verifySigning(): Promise<void> {
  const signWith = requireEnv("TURNKEY_SIGN_WITH");
  const signerAddress = requireEnv("TURNKEY_SIGNER_ADDRESS") as `0x${string}`;

  const signer = new TurnkeyOrderSigner({
    organizationId,
    signWith,
    signerAddress,
    stamper,
  });

  const typedData = {
    domain: { name: "Mayarin", version: "1", chainId: 84532, verifyingContract: signerAddress },
    types: { Probe: [{ name: "nonce", type: "uint256" }] },
    primaryType: "Probe",
    message: { nonce: BigInt(Date.now()) },
  } as const;

  console.log(`[turnkey] signing a probe with ${signWith}`);
  const signature = await signer.sign(typedData as never);
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });

  console.log(`[turnkey] recovered: ${recovered}`);
  if (recovered.toLowerCase() !== signerAddress.toLowerCase()) {
    console.error(`[turnkey] MISMATCH — expected ${signerAddress}`);
    console.error("TURNKEY_SIGN_WITH and TURNKEY_SIGNER_ADDRESS name different keys.");
    process.exit(1);
  }
  console.log("[turnkey] signature verifies against TURNKEY_SIGNER_ADDRESS");
}

async function createWallet(name: string): Promise<void> {
  console.log(`[turnkey] creating wallet "${name}" in ${organizationId}`);

  const activity = await submit("create_wallet", {
    type: "ACTIVITY_TYPE_CREATE_WALLET",
    timestampMs: String(Date.now()),
    organizationId,
    parameters: {
      walletName: name,
      accounts: [
        {
          curve: "CURVE_SECP256K1",
          pathFormat: "PATH_FORMAT_BIP32",
          // The standard Ethereum path. Anything else works too, but a
          // non-standard path is a thing to remember at recovery time.
          path: "m/44'/60'/0'/0/0",
          addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        },
      ],
    },
  });

  const result = activity?.result?.createWalletResult;
  const address = result?.addresses?.[0];

  if (typeof address !== "string") {
    // An activity can come back PENDING when a policy requires consensus. That
    // is a real outcome, not a failure — say so rather than printing undefined.
    console.error(`[turnkey] no address in the response; activity status: ${activity?.status}`);
    console.error(JSON.stringify(activity, null, 2));
    process.exit(1);
  }

  console.log(`\n[turnkey] wallet created: ${result?.walletId}`);
  console.log(`[turnkey] address:         ${address}\n`);
  console.log("Put these in .env:\n");
  console.log(`TURNKEY_SIGN_WITH=${address}`);
  console.log(`TURNKEY_SIGNER_ADDRESS=${address}`);
  console.log(`
Do NOT flip QUOTE_SIGNER=turnkey yet. The deployed PaymentRouter stores the
address it accepts orders from, and it is still the local key's. Update the
contract's signer role through the timelock first, or every contract-path
payment fails at submit.`);
}

async function listWallets(): Promise<void> {
  const response = await post("/public/v1/query/list_wallets", {
    organizationId,
  });
  console.log(JSON.stringify(response, null, 2));
}

async function submit(path: string, body: unknown): Promise<ActivityResponse["activity"]> {
  const response = (await post(`/public/v1/submit/${path}`, body)) as ActivityResponse;
  return response.activity;
}

async function post(path: string, body: unknown): Promise<unknown> {
  const serialized = JSON.stringify(body);
  const response = await fetch(`${DEFAULT_TURNKEY_ENDPOINT}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Turnkey authenticates the *body*, not the connection: a stolen header
      // cannot be replayed against a different request.
      "X-Stamp": await stamper.stamp(serialized),
    },
    body: serialized,
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`[turnkey] ${response.status} ${response.statusText}`);
    console.error(text);
    process.exit(1);
  }
  return JSON.parse(text);
}

interface ActivityResponse {
  readonly activity?: {
    readonly id?: string;
    readonly status?: string;
    readonly result?: {
      readonly createWalletResult?: {
        readonly walletId?: string;
        readonly addresses?: readonly string[];
      };
    };
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    console.error(`[turnkey] ${name} is not set in .env`);
    process.exit(1);
  }
  return value;
}
