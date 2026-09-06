/**
 * Merchant wallet route tests (#11).
 *
 * Signatures here are produced by a real key, because the whole claim is that
 * "verified" means a signature was recovered and matched. A stubbed verifier
 * would let these pass while the property they assert was false.
 */

import { describe, expect, test } from "bun:test";
import { generateId } from "@mayarin/shared";
import { privateKeyToAccount } from "viem/accounts";
import { cookieJar, createDashboardHarness, TREASURY_ADDRESS } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
const MERCHANT_KEY = `0x${"11".repeat(32)}` as const;
const OTHER_KEY = `0x${"22".repeat(32)}` as const;
/** Stands in for the key a passkey authorises inside the provider's enclave. */
const PASSKEY_KEY = `0x${"33".repeat(32)}` as const;

/** A WebAuthn credential as a browser would hand it over. Opaque here. */
const ATTESTATION = {
  name: "Merchant's phone",
  credentialId: "credential-id",
  challenge: "webauthn-challenge",
  clientDataJson: "client-data",
  attestationObject: "attestation-object",
  transports: ["internal"],
};

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seed() {
  return createDashboardHarness({ adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
}

async function loginAs(harness: Harness, email: string, password: string) {
  const res = await harness.request("POST", "/v1/auth/login", { body: { email, password } });
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

type Auth = Awaited<ReturnType<typeof loginAs>>;

async function post(harness: Harness, auth: Auth, path: string, body: unknown = {}) {
  return harness.request("POST", path, {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

/** Links, then proves control — the state managed provisioning requires. */
async function linkAndVerify(harness: Harness, auth: Auth) {
  const { id, account } = await link(harness, auth);
  const challenge = await post(harness, auth, `/v1/wallets/${id}/challenge`);
  const signature = await account.signMessage({ message: challenge.body?.message as string });
  await post(harness, auth, `/v1/wallets/${id}/verify`, {
    challengeId: challenge.body?.challengeId,
    signature,
  });
  return { id, account };
}

/** Links the merchant key's address and returns the wallet id. */
async function link(harness: Harness, auth: Auth) {
  const account = privateKeyToAccount(MERCHANT_KEY);
  const res = await post(harness, auth, "/v1/wallets", {
    chain: "base-sepolia",
    address: account.address,
  });
  // Read defensively: a duplicate claim answers 409 with no wallet, and the
  // helper is used by the test that asserts exactly that.
  return { id: (res.body?.wallet?.id ?? "") as string, account, res };
}

describe("linking", () => {
  test("a linked wallet starts unverified", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { res } = await link(harness, auth);

    expect(res.status).toBe(201);
    // Linking is a claim. The guard does not accept claims.
    expect(res.body?.wallet.verified).toBe(false);
    expect(res.body?.wallet.provenance).toBe("linked");
  });

  test("the address is stored lowercased", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const account = privateKeyToAccount(MERCHANT_KEY);

    const res = await post(harness, auth, "/v1/wallets", {
      chain: "base-sepolia",
      address: account.address.toUpperCase().replace("0X", "0x"),
    });

    expect(res.body?.wallet.address).toBe(account.address.toLowerCase());
  });

  test("a malformed address is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await post(harness, auth, "/v1/wallets", {
      chain: "base-sepolia",
      address: "0xnope",
    });
    expect(res.status).toBe(400);
  });

  test("an address already claimed is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await link(harness, auth);

    const again = await link(harness, auth);
    expect(again.res.status).toBe(409);
  });
});

describe("proving control", () => {
  test("a signature from the address verifies the wallet", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id, account } = await link(harness, auth);

    const challenge = await post(harness, auth, `/v1/wallets/${id}/challenge`);
    const signature = await account.signMessage({ message: challenge.body?.message as string });

    const verified = await post(harness, auth, `/v1/wallets/${id}/verify`, {
      challengeId: challenge.body?.challengeId,
      signature,
    });

    expect(verified.status).toBe(200);
    expect(verified.body?.wallet.verified).toBe(true);
  });

  test("the message says plainly that it moves no funds", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id } = await link(harness, auth);

    const challenge = await post(harness, auth, `/v1/wallets/${id}/challenge`);

    // A wallet prompt showing opaque hex is a prompt people approve unread.
    expect(challenge.body?.message).toContain("moves no funds");
    expect(challenge.body?.message).toContain(harness.merchantId);
  });

  test("a signature from a different key is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id } = await link(harness, auth);

    const challenge = await post(harness, auth, `/v1/wallets/${id}/challenge`);
    const impostor = privateKeyToAccount(OTHER_KEY);
    const signature = await impostor.signMessage({ message: challenge.body?.message as string });

    const res = await post(harness, auth, `/v1/wallets/${id}/verify`, {
      challengeId: challenge.body?.challengeId,
      signature,
    });
    expect(res.status).toBe(400);
  });

  test("a challenge is consumed, so one signature proves control once", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id, account } = await link(harness, auth);

    const challenge = await post(harness, auth, `/v1/wallets/${id}/challenge`);
    const signature = await account.signMessage({ message: challenge.body?.message as string });
    const body = { challengeId: challenge.body?.challengeId, signature };

    expect((await post(harness, auth, `/v1/wallets/${id}/verify`, body)).status).toBe(200);
    // Replaying it after an unlink-and-reclaim is exactly what this prevents.
    expect((await post(harness, auth, `/v1/wallets/${id}/verify`, body)).status).toBe(409);
  });

  test("verification without a CSRF token is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id } = await link(harness, auth);

    const res = await harness.request("POST", `/v1/wallets/${id}/challenge`, { cookies: auth.jar });
    expect(res.status).toBe(403);
  });
});

describe("scoping", () => {
  test("another merchant's wallet is not found", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { id } = await link(harness, auth);

    const other = await harness.container.users.createMerchantAccount({
      email: "other@mayarin.local",
      password: "other-password-12345",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: [],
      permissions: ["settings:manage"],
    });
    expect(other.user.merchantId).not.toBe(harness.merchantId);

    const theirs = await loginAs(harness, "other@mayarin.local", "other-password-12345");
    const res = await post(harness, theirs, `/v1/wallets/${id}/challenge`);

    expect(res.status).toBe(404);
  });

  test("a caller without settings:manage is refused", async () => {
    const harness = await seed();
    const now = harness.clock.now();
    await harness.users.insert({
      id: generateId("usr", now.getTime()),
      email: "reader@mayarin.local",
      passwordHash: "plain:reader-password-1",
      merchantId: harness.merchantId,
      permissions: ["payments:read"],
      createdAt: now,
      updatedAt: now,
    });
    const auth = await loginAs(harness, "reader@mayarin.local", "reader-password-1");

    const res = await harness.request("GET", "/v1/wallets", { cookies: auth.jar });
    expect(res.status).toBe(403);
  });
});

describe("passkey wallets", () => {
  test("a merchant who holds nothing gets a key, unverified", async () => {
    // The onboarding claim: no MetaMask, no seed phrase, no gas. What comes back
    // is still a claim, because a key that turns out not to sign would become a
    // Safe owner that cannot act.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await post(harness, auth, "/v1/wallets/passkey", {
      chain: "base-sepolia",
      attestation: ATTESTATION,
    });

    expect(res.status).toBe(201);
    expect(res.body?.wallet.provenance).toBe("passkey");
    expect(res.body?.wallet.verified).toBe(false);
    // The browser needs the handle to sign with the passkey later.
    expect(res.body?.wallet.keyRef).toBe(`merchant-key-sub-${harness.merchantId}-1`);
  });

  test("the attestation reaches the provider", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    await post(harness, auth, "/v1/wallets/passkey", {
      chain: "base-sepolia",
      attestation: ATTESTATION,
    });

    expect(harness.merchantKeyProvider.attestations).toHaveLength(1);
    expect(harness.merchantKeyProvider.attestations[0]?.attestation.credentialId).toBe(
      ATTESTATION.credentialId,
    );
    // Scoped: the provider is told whose key it is, and a merchant cannot ask
    // for one on another merchant's behalf because no route takes a merchant id.
    expect(harness.merchantKeyProvider.attestations[0]?.merchantId).toBe(harness.merchantId);
  });

  test("a malformed attestation is refused before the provider is called", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await post(harness, auth, "/v1/wallets/passkey", {
      chain: "base-sepolia",
      attestation: { ...ATTESTATION, transports: ["carrier-pigeon"] },
    });

    expect(res.status).toBe(400);
    expect(harness.merchantKeyProvider.attestations).toHaveLength(0);
  });

  test("a passkey key becomes payable on a signature, like any other address", async () => {
    // The whole chain, end to end: the key signs the challenge this deployment
    // issued, and only then is it a wallet the guard would let money reach.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const account = privateKeyToAccount(PASSKEY_KEY);
    harness.merchantKeyProvider.addresses.push(account.address);

    const created = await post(harness, auth, "/v1/wallets/passkey", {
      chain: "base-sepolia",
      attestation: ATTESTATION,
    });
    const id = created.body?.wallet.id as string;
    const challenge = await post(harness, auth, `/v1/wallets/${id}/challenge`);
    const signature = await account.signMessage({ message: challenge.body?.message as string });
    const verified = await post(harness, auth, `/v1/wallets/${id}/verify`, {
      challengeId: challenge.body?.challengeId,
      signature,
    });

    expect(verified.body?.wallet.verified).toBe(true);
  });

  test("a verified passkey key is enough to be provisioned a Safe", async () => {
    // The journey this exists for: sign up, create a passkey, prove it signs,
    // get a Safe you already own. No wallet was ever connected.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const account = privateKeyToAccount(PASSKEY_KEY);
    harness.merchantKeyProvider.addresses.push(account.address);

    const created = await post(harness, auth, "/v1/wallets/passkey", {
      chain: "base-sepolia",
      attestation: ATTESTATION,
    });
    const id = created.body?.wallet.id as string;
    const challenge = await post(harness, auth, `/v1/wallets/${id}/challenge`);
    await post(harness, auth, `/v1/wallets/${id}/verify`, {
      challengeId: challenge.body?.challengeId,
      signature: await account.signMessage({ message: challenge.body?.message as string }),
    });

    const managed = await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });

    expect(managed.status).toBe(200);
    expect(managed.body?.wallet.signers.merchant).toBe(account.address.toLowerCase());
  });
});

describe("managed provisioning", () => {
  test("provisions a wallet the merchant is already a signer on", async () => {
    // The differentiator: a merchant who has never held a wallet is
    // self-custodial from their first payment, because their own verified
    // address is in the signer set at creation rather than added later.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { account } = await linkAndVerify(harness, auth);

    const res = await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });

    expect(res.status).toBe(200);
    expect(res.body?.wallet.provenance).toBe("provisioned");
    expect(res.body?.wallet.verified).toBe(true);
    expect(res.body?.wallet.signers.merchant).toBe(account.address.toLowerCase());
  });

  test("refuses until the merchant has proved control of an address", async () => {
    // Provisioning around an address the merchant merely claimed would let
    // anyone with settings:manage name a co-owner of a wallet Mayarin creates.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await link(harness, auth);

    const res = await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });

    expect(res.status).toBe(400);
  });

  test("asking twice returns the same wallet and deploys once", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await linkAndVerify(harness, auth);

    const first = await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });
    const second = await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });

    expect(second.body?.wallet.id).toBe(first.body?.wallet.id);
    // Two smart accounts would be two addresses a payer could be told to pay.
    expect(harness.walletProvider.deploys).toHaveLength(1);
    expect(harness.walletProvider.signers).toHaveLength(1);
  });

  test("a merchant keeps their linked wallet alongside the managed one", async () => {
    // Connect-existing does not become second-class the moment provisioning
    // exists: both are on file, both verified, and the settlement address
    // decides which is paid.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await linkAndVerify(harness, auth);
    await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });

    const listed = await harness.request("GET", "/v1/wallets", { cookies: auth.jar });
    const wallets = (listed.body?.wallets ?? []) as { provenance: string }[];
    const provenances = wallets.map((wallet) => wallet.provenance).sort();

    expect(provenances).toEqual(["linked", "provisioned"]);
  });

  test("one merchant cannot provision into another's tenant", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await linkAndVerify(harness, auth);
    await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });

    await harness.container.users.createMerchantAccount({
      email: "other@mayarin.local",
      password: "other-password-12345",
      merchantName: "Other",
      settlementAsset: "USDC",
      acceptedAssets: [],
      permissions: ["settings:manage"],
    });
    const theirs = await loginAs(harness, "other@mayarin.local", "other-password-12345");
    const res = await post(harness, theirs, "/v1/wallets/managed", { chain: "base-sepolia" });

    // No verified address of their own, so nothing is provisioned — and
    // certainly not the first merchant's wallet handed over.
    expect(res.status).toBe(400);
    expect(harness.walletProvider.deploys).toHaveLength(1);
  });

  test("provisioning without a CSRF token is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await harness.request("POST", "/v1/wallets/managed", {
      body: { chain: "base-sepolia" },
      cookies: auth.jar,
    });
    expect(res.status).toBe(403);
  });
});

describe("the fee destination", () => {
  test("cannot be claimed as a merchant wallet", async () => {
    // A fee recipient that is also a payout destination pays a merchant twice
    // and the ledger shows one payment. Refused at the moment it is typed,
    // rather than at the merchant's first payment.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await post(harness, auth, "/v1/wallets", {
      chain: "base-sepolia",
      address: TREASURY_ADDRESS,
    });

    expect(res.status).toBe(400);
  });
});

describe("the settlement balance", () => {
  test("reports the address the merchant configured, and refuses to call it withdrawable", async () => {
    // An address the merchant holds themselves is not one Mayarin can move
    // from, and offering a withdraw button for it would be a lie.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const configured = `0x${"cc".repeat(20)}`;
    harness.walletBalances.set(configured, "USDC", 1_500_000n);
    harness.walletBalances.set(configured, "ETH", 3_000_000_000_000_000n);

    await harness.request("PATCH", "/v1/settings", {
      body: { settlementAddress: configured },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });

    const res = await harness.request("GET", "/v1/wallets/balance", { cookies: auth.jar });

    expect(res.status).toBe(200);
    // One row per configured chain: a merchant paid on Base and on Arc has two
    // addresses holding two balances, and reporting one of them made the other
    // chain's money invisible (#244).
    expect(res.body?.balances.map((row: { chain: string }) => row.chain)).toEqual([
      "base-sepolia",
      "arc-testnet",
    ]);
    const base = res.body?.balances[0];
    expect(base.address).toBe(configured);
    expect(base.withdrawable).toBe(false);
    expect(base.balances).toEqual([
      { amount: "1500000", asset: "USDC", formatted: "1.500000", display: "1,50 USDC" },
      {
        amount: "3000000000000000",
        asset: "ETH",
        formatted: "0.003000000000000000",
        display: "0,003 ETH",
      },
    ]);
  });

  test("falls back to the provisioned wallet, which Mayarin can move from", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await linkAndVerify(harness, auth);
    const provisioned = await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });
    const address = provisioned.body?.wallet.address as string;
    harness.walletBalances.set(address, "USDC", 42n);

    const res = await harness.request("GET", "/v1/wallets/balance", { cookies: auth.jar });

    const base = res.body?.balances[0];
    expect(base.address).toBe(address);
    expect(base.withdrawable).toBe(true);
    expect(base.balances[0].amount).toBe("42");

    // Provisioned on Base only, so Arc has an address of nowhere — reported as
    // a row rather than omitted, because a missing row and an empty one read
    // the same and only one of them says there is something to do.
    const arc = res.body?.balances[1];
    expect(arc.chain).toBe("arc-testnet");
    expect(arc.address).toBeNull();
  });

  test("an asset this deployment has no token address for is omitted, not zeroed", async () => {
    // Nothing configured and an empty wallet are different answers, and a
    // merchant reading a zero would take the wrong action.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const configured = `0x${"dd".repeat(20)}`;
    await harness.request("PATCH", "/v1/settings", {
      body: { settlementAddress: configured },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });

    const res = await harness.request("GET", "/v1/wallets/balance", { cookies: auth.jar });

    expect(res.body?.balances[0].balances).toEqual([]);
  });

  test("reports which networks this merchant can be paid on, and why not the rest", async () => {
    // The reason is the point: "no settlement address on Arc" is a settings
    // change the merchant can make, where a payment that refuses to lock three
    // days later is not (#244).
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await linkAndVerify(harness, auth);
    await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });

    const res = await harness.request("GET", "/v1/wallets/rails", { cookies: auth.jar });

    expect(res.status).toBe(200);
    // Base offers both of its assets; Arc offers nothing, because there is
    // nowhere to pay this merchant there.
    expect(
      res.body?.rails.map(
        (rail: { chain: string; asset: string }) => `${rail.chain}:${rail.asset}`,
      ),
    ).toEqual(["base-sepolia:USDC", "base-sepolia:ETH"]);
    expect(res.body?.unavailable).toContainEqual({
      kind: "no-settlement-destination",
      chain: "arc-testnet",
      asset: null,
      reason: expect.stringContaining("provision a managed wallet"),
    });
  });
});

describe("withdrawing", () => {
  /** A provisioned wallet plus a verified own address to withdraw to. */
  async function withdrawable(harness: Harness, auth: Auth) {
    const { account } = await linkAndVerify(harness, auth);
    const provisioned = await post(harness, auth, "/v1/wallets/managed", { chain: "base-sepolia" });
    return { destination: account.address.toLowerCase(), safe: provisioned.body?.wallet.address };
  }

  test("reaches the provider with the amount and destination the merchant asked for", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { destination, safe } = await withdrawable(harness, auth);

    const res = await post(harness, auth, "/v1/wallets/withdraw", {
      chain: "base-sepolia",
      asset: "USDC",
      amount: "2500000",
      to: destination,
    });

    expect(res.status).toBe(200);
    expect(res.body?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(harness.walletProvider.proposals).toHaveLength(1);
    const proposal = harness.walletProvider.proposals[0];
    expect(proposal?.wallet.address).toBe(safe);
    expect(proposal?.intent).toEqual({
      kind: "withdraw",
      amount: { amount: 2_500_000n, asset: "USDC" },
      to: destination,
    });

    const history = await harness.request("GET", "/v1/wallets/withdrawals", {
      cookies: auth.jar,
    });
    expect(history.status).toBe(200);
    expect(history.body?.withdrawals).toEqual([
      {
        id: expect.stringMatching(/^wdr_/),
        chain: "base-sepolia",
        walletAddress: safe,
        destinationAddress: destination,
        amount: {
          amount: "2500000",
          asset: "USDC",
          formatted: "2.500000",
          display: "2,50 USDC",
        },
        transactionHash: res.body?.txHash,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("refuses a destination the merchant never proved they control", async () => {
    // A dashboard session is a bearer credential; an arbitrary destination
    // turns a stolen one into a transfer. Proving control is the step an
    // attacker holding a session cannot take.
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await withdrawable(harness, auth);

    const res = await post(harness, auth, "/v1/wallets/withdraw", {
      chain: "base-sepolia",
      asset: "USDC",
      amount: "1",
      to: `0x${"ee".repeat(20)}`,
    });

    expect(res.status).toBe(400);
    expect(harness.walletProvider.proposals).toHaveLength(0);
  });

  test("refuses a linked destination that was never verified", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await withdrawable(harness, auth);
    const unverified = privateKeyToAccount(OTHER_KEY);
    await post(harness, auth, "/v1/wallets", {
      chain: "base-sepolia",
      address: unverified.address,
    });

    const res = await post(harness, auth, "/v1/wallets/withdraw", {
      chain: "base-sepolia",
      asset: "USDC",
      amount: "1",
      to: unverified.address,
    });

    expect(res.status).toBe(400);
    expect(harness.walletProvider.proposals).toHaveLength(0);
  });

  test("refuses when the merchant has no provisioned wallet", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { account } = await linkAndVerify(harness, auth);

    const res = await post(harness, auth, "/v1/wallets/withdraw", {
      chain: "base-sepolia",
      asset: "USDC",
      amount: "1",
      to: account.address,
    });

    expect(res.status).toBe(404);
  });

  test("refuses a non-positive amount", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { destination } = await withdrawable(harness, auth);

    const res = await post(harness, auth, "/v1/wallets/withdraw", {
      chain: "base-sepolia",
      asset: "USDC",
      amount: "0",
      to: destination,
    });

    expect(res.status).toBe(400);
  });

  test("without a CSRF token is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { destination } = await withdrawable(harness, auth);

    const res = await harness.request("POST", "/v1/wallets/withdraw", {
      body: { asset: "USDC", amount: "1", to: destination },
      cookies: auth.jar,
    });

    expect(res.status).toBe(403);
  });
});
