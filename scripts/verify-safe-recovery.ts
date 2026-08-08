/**
 * Proves a merchant can remove Mayarin from their own Safe (#11).
 *
 * This is the custody claim, and a claim nobody has executed is a claim. So it
 * is executed: a Safe is provisioned exactly as a merchant's would be, then
 * `removeOwner` is submitted carrying **only the merchant's signature**, and
 * the owner set is read back.
 *
 * Gas comes from the operator key, which is not the same thing as authority —
 * a Safe cares who signed, not who paid. That distinction is the reason
 * threshold 1 gives a real exit even before #9 sponsors the gas.
 *
 *   bun --env-file=.env run scripts/verify-safe-recovery.ts
 */

import { ApiKeyStamper, SAFE_BASE_SEPOLIA, TurnkeyWalletProvider } from "@mayarin/provider-turnkey";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
  parseAbi,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const SAFE_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function nonce() view returns (uint256)",
  "function removeOwner(address prevOwner, address owner, uint256 _threshold)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);

const SENTINEL = "0x0000000000000000000000000000000000000001" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const rpcUrl = JSON.parse(requireEnv("CHAIN_RPC_URLS"))["base-sepolia"];
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const relayer = privateKeyToAccount(requireEnv("OPERATOR_PRIVATE_KEY") as Hex);
const walletClient = createWalletClient({
  account: relayer,
  chain: baseSepolia,
  transport: http(rpcUrl),
});

// A key standing in for the merchant's own. Generated here so the proof cannot
// lean on anything Mayarin already controls.
const merchant = privateKeyToAccount(generatePrivateKey());
console.log(`merchant key  ${merchant.address}`);

const provider = new TurnkeyWalletProvider({
  organizationId: requireEnv("TURNKEY_ORGANIZATION_ID"),
  stamper: new ApiKeyStamper({
    apiPublicKey: requireEnv("TURNKEY_API_PUBLIC_KEY"),
    apiPrivateKey: requireEnv("TURNKEY_API_PRIVATE_KEY"),
  }),
  deployerPrivateKey: requireEnv("OPERATOR_PRIVATE_KEY") as Hex,
  rpcUrl,
  safe: SAFE_BASE_SEPOLIA,
});

const wallet = await provider.provision({
  merchantId: "recovery-proof",
  chain: "base-sepolia",
  merchantSigner: merchant.address,
});
const safe = wallet.address as Hex;

const before = await publicClient.readContract({
  address: safe,
  abi: SAFE_ABI,
  functionName: "getOwners",
});
console.log(`safe          ${safe}`);
console.log(`owners before ${before.join(", ")}`);

const mayarin = before.find((owner) => owner.toLowerCase() !== merchant.address.toLowerCase());
if (mayarin === undefined) {
  console.error("no Mayarin owner to remove — the Safe was not provisioned as expected");
  process.exit(1);
}

// Owners are a linked list; removing one needs its predecessor. With two
// owners the predecessor is either the sentinel or the other owner.
const mayarinIndex = before.findIndex((owner) => owner.toLowerCase() === mayarin.toLowerCase());
const prevOwner = mayarinIndex === 0 ? SENTINEL : (before[mayarinIndex - 1] as Hex);

const data = encodeFunctionData({
  abi: SAFE_ABI,
  functionName: "removeOwner",
  args: [prevOwner, mayarin, 1n],
});

const nonce = await publicClient.readContract({
  address: safe,
  abi: SAFE_ABI,
  functionName: "nonce",
});
const txHash = await publicClient.readContract({
  address: safe,
  abi: SAFE_ABI,
  functionName: "getTransactionHash",
  args: [safe, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce],
});

// Signed by the merchant alone. Nothing Mayarin holds contributes to this.
const signature = await merchant.sign({ hash: txHash });

const sent = await walletClient.writeContract({
  address: safe,
  abi: SAFE_ABI,
  functionName: "execTransaction",
  args: [safe, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: sent });
if (receipt.status !== "success") {
  console.error(`removeOwner reverted: ${sent}`);
  process.exit(1);
}

// Pinned to the execution block and retried: behind a load balancer the node
// serving this may not have that block yet. Reading `latest` would trade a
// clear error for a stale answer, and a stale answer here would claim the
// merchant took control when they might not have.
const after = await readAtBlock(() =>
  publicClient.readContract({
    address: safe,
    abi: SAFE_ABI,
    functionName: "getOwners",
    blockNumber: receipt.blockNumber,
  }),
);
console.log(`owners after  ${after.join(", ")}`);

const stillThere = after.some((owner) => owner.toLowerCase() === mayarin.toLowerCase());
if (stillThere) {
  console.error("\nFAIL — Mayarin is still an owner.");
  process.exit(1);
}
console.log(`\nMayarin removed by the merchant alone. tx ${sent}`);
console.log("The merchant now solely controls the Safe. Exit is real, not asserted.");

async function readAtBlock<T>(read: () => Promise<T>, attempts = 8): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}
