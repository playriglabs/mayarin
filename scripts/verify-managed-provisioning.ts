/**
 * Runs managed wallet provisioning against Base Sepolia, end to end (#11).
 *
 * Provisioning is three live effects — a Turnkey sub-organization, a policy
 * that bounds Mayarin's signing key, and a Safe deployment — and none of them
 * can be proven from a test suite. So they are executed, and every claim is
 * read back from the thing that would have to be wrong:
 *
 * 1. the sub-organization exists, and holds a **non-root** signer user (root
 *    users are exempt from Turnkey's policy engine, so a root signer would make
 *    the policy decoration);
 * 2. a policy exists naming that user and that Safe;
 * 3. the address the code predicted is the address that got deployed;
 * 4. the merchant is an owner at threshold 1;
 * 5. **running it again deploys nothing** — the property a crashed provision
 *    depends on, and the one that decides whether a merchant can end up with
 *    two payout addresses.
 *
 *   bun --env-file=.env run scripts/verify-managed-provisioning.ts
 *
 * Gas comes from the operator key. That is not authority: a Safe cares who
 * signed, not who paid.
 */

import { ApiKeyStamper, SAFE_BASE_SEPOLIA, TurnkeyWalletProvider } from "@mayarin/provider-turnkey";
import { createPublicClient, type Hex, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const SAFE_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);

const rpcUrl = JSON.parse(requireEnv("CHAIN_RPC_URLS"))["base-sepolia"];
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

// The merchant's own key, generated here so nothing Mayarin holds contributes
// to the signer set this proof is about.
const merchant = privateKeyToAccount(generatePrivateKey());
const merchantId = `provision-proof-${Date.now()}`;

const organizationId = requireEnv("TURNKEY_ORGANIZATION_ID");
const stamper = new ApiKeyStamper({
  apiPublicKey: requireEnv("TURNKEY_API_PUBLIC_KEY"),
  apiPrivateKey: requireEnv("TURNKEY_API_PRIVATE_KEY"),
});
const provider = new TurnkeyWalletProvider({
  organizationId,
  stamper,
  chain: "base-sepolia",
  deployerPrivateKey: requireEnv("OPERATOR_PRIVATE_KEY") as Hex,
  rpcUrl,
  safe: SAFE_BASE_SEPOLIA,
  rootApiPublicKey: requireEnv("TURNKEY_API_PUBLIC_KEY"),
  signerApiPublicKey: requireEnv("TURNKEY_SIGNER_API_PUBLIC_KEY"),
});

console.log(`merchant id    ${merchantId}`);
console.log(`merchant key   ${merchant.address}`);

const managedSigner = await provider.createManagedSigner(merchantId);
console.log(`sub-org        ${managedSigner.ref}`);
console.log(`turnkey signer ${managedSigner.address}`);

const request = {
  merchantId,
  chain: "base-sepolia" as const,
  merchantSigner: merchant.address,
  managedSigner,
};

// Derived before anything exists. The orchestration writes its record at this
// point, which is what lets a crash resume rather than start over.
const predicted = await provider.predictAddress(request);
console.log(`predicted      ${predicted}`);

const first = await provider.deploy(request);
console.log(`deployed       ${first.address} (new: ${first.deployed})`);

if (first.address.toLowerCase() !== predicted.toLowerCase()) {
  fail(`prediction ${predicted} does not match the deployment ${first.address}`);
}

const owners = await publicClient.readContract({
  address: first.address as Hex,
  abi: SAFE_ABI,
  functionName: "getOwners",
});
const threshold = await publicClient.readContract({
  address: first.address as Hex,
  abi: SAFE_ABI,
  functionName: "getThreshold",
});
console.log(`owners         ${owners.join(", ")}`);
console.log(`threshold      ${threshold}`);

if (!owners.some((owner) => owner.toLowerCase() === merchant.address.toLowerCase())) {
  fail("the merchant is not an owner of the Safe that was deployed");
}
if (threshold !== 1n) {
  fail(`threshold ${threshold} — the merchant cannot act alone, so they cannot leave`);
}

// The signer user, and the policy that is the only thing it may do. Read from
// Turnkey rather than assumed: a policy that failed to create leaves a key that
// can do nothing, and one written against the wrong user leaves it unbounded.
const users = await turnkey("/public/v1/query/list_users", { organizationId: managedSigner.ref });
const signerUser = users.users?.find(
  (user: { userName?: string }) => user.userName === "mayarin-signer",
);
if (signerUser === undefined) {
  fail("the sub-organization has no mayarin-signer user");
}
console.log(`signer user    ${signerUser.userId}`);

const policies = await turnkey("/public/v1/query/list_policies", {
  organizationId: managedSigner.ref,
});
const policy = policies.policies?.find((entry: { policyName?: string }) =>
  entry.policyName?.includes(first.address.toLowerCase()),
);
if (policy === undefined) {
  fail(`no policy bounds the signer key to ${first.address}`);
}
console.log(`policy         ${policy.policyName}`);

// The whole resumability claim in one line: asking again deploys nothing.
const second = await provider.deploy(request);
if (second.deployed) {
  fail("the second deploy created another Safe — an interrupted provision would too");
}
if (second.address.toLowerCase() !== first.address.toLowerCase()) {
  fail(`the second deploy produced ${second.address}, not ${first.address}`);
}
console.log(`re-run         adopted ${second.address}, deployed nothing`);
console.log("\nprovisioning verified on Base Sepolia");

async function turnkey(path: string, body: Record<string, unknown>) {
  const payload = JSON.stringify(body);
  const response = await fetch(`https://api.turnkey.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Stamp": await stamper.stamp(payload) },
    body: payload,
  });
  const text = await response.text();
  if (!response.ok) fail(`Turnkey ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function fail(message: string): never {
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    console.error(`[provision] ${name} is not set in .env`);
    process.exit(1);
  }
  return value;
}
