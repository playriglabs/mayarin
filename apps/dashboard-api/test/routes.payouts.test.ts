/**
 * Batch payout route tests (#295).
 *
 * The chain is a fake the test fills with the receipt it wants read back: what
 * is under test is that a batch is recorded only when that receipt proves every
 * row, and that the calldata handed to the merchant's wallet is the Safe call.
 */

import { describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import { decodeFunctionData, parseAbi } from "viem";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
const SAFE = `0x${"5a".repeat(20)}`;
const OWNER = `0x${"0e".repeat(20)}`;
const ALICE = `0x${"a1".repeat(20)}`;
const BOB = `0x${"b2".repeat(20)}`;
const HASH = `0x${"cd".repeat(32)}`;
const CSV = `address,amount,asset,note\n${ALICE},12.5,USDC,September\n${BOB},3,USDC`;

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seed({ managed = true } = {}) {
  const harness = await createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
  if (managed) {
    const now = harness.clock.now();
    await harness.merchantWallets.insert({
      id: "wlt_safe",
      merchantId: harness.merchantId,
      chain: "base-sepolia",
      address: SAFE,
      provenance: "provisioned",
      verifiedAt: now,
      managed: { ref: "sub-org", address: `0x${"99".repeat(20)}`, merchantSigner: OWNER },
      createdAt: now,
      updatedAt: now,
    });
  }
  const res = await harness.request("POST", "/v1/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const jar = cookieJar(res.setCookies);
  return { harness, auth: { jar, csrf: jar.mayarin_csrf ?? "" } };
}

type Auth = Awaited<ReturnType<typeof seed>>["auth"];

function post(harness: Harness, auth: Auth, path: string, body: unknown) {
  return harness.request("POST", path, {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

function paid(harness: Harness, overrides: Record<string, unknown> = {}) {
  harness.payoutReceipts.set(HASH, {
    succeeded: true,
    from: OWNER,
    to: SAFE,
    transfers: [
      { from: SAFE, to: ALICE, amount: money(12_500_000n, "USDC") },
      { from: SAFE, to: BOB, amount: money(3_000_000n, "USDC") },
    ],
    ...overrides,
  });
}

describe("POST /payouts/prepare", () => {
  test("returns the Safe call the owner's wallet submits", async () => {
    const { harness, auth } = await seed();

    const res = await post(harness, auth, "/v1/payouts/prepare", {
      chain: "base-sepolia",
      source: "safe",
      csv: CSV,
    });

    expect(res.status).toBe(200);
    expect(res.body?.errors).toEqual([]);
    expect(res.body?.rows).toHaveLength(2);
    expect(res.body?.totals).toEqual([
      expect.objectContaining({ amount: "15500000", asset: "USDC" }),
    ]);
    const tx = res.body?.transaction;
    expect(tx.from).toBe(OWNER);
    expect(tx.to).toBe(SAFE);

    const call = decodeFunctionData({
      abi: parseAbi([
        "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)",
      ]),
      data: tx.data,
    });
    expect(call.args[0]).toBe("0x9641d764fc13c8B624c04430C7356C1C7C8102e2");
    expect(call.args[3]).toBe(1); // DELEGATECALL into MultiSendCallOnly
    // Pre-validated signature: r = owner, s = 0, v = 1.
    expect(call.args[9]).toBe(`0x${"0".repeat(24)}${OWNER.slice(2)}${"0".repeat(64)}01`);
  });

  test("reports row errors and offers no transaction", async () => {
    const { harness, auth } = await seed();

    const res = await post(harness, auth, "/v1/payouts/prepare", {
      chain: "base-sepolia",
      source: "safe",
      csv: `${ALICE},1,DAI\n${BOB},1,USDC`,
    });

    expect(res.status).toBe(200);
    expect(res.body?.errors).toEqual([expect.objectContaining({ line: 1 })]);
    expect(res.body?.transaction).toBeNull();
  });

  test("a merchant with no managed wallet is refused", async () => {
    const { harness, auth } = await seed({ managed: false });

    const res = await post(harness, auth, "/v1/payouts/prepare", {
      chain: "base-sepolia",
      source: "safe",
      csv: CSV,
    });

    expect(res.status).toBe(404);
  });

  test("without a CSRF token is refused", async () => {
    const { harness, auth } = await seed();
    const res = await harness.request("POST", "/v1/payouts/prepare", {
      body: { chain: "base-sepolia", source: "safe", csv: CSV },
      cookies: auth.jar,
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /payouts", () => {
  test("records a batch the chain proves row for row, once", async () => {
    const { harness, auth } = await seed();
    paid(harness);

    const first = await post(harness, auth, "/v1/payouts", {
      chain: "base-sepolia",
      source: "safe",
      csv: CSV,
      transactionHash: HASH,
    });
    const again = await post(harness, auth, "/v1/payouts", {
      chain: "base-sepolia",
      source: "safe",
      csv: CSV,
      transactionHash: HASH,
    });

    expect(first.status).toBe(201);
    expect(first.body?.batch).toMatchObject({
      chain: "base-sepolia",
      sourceAddress: SAFE,
      submittedBy: OWNER,
      transactionHash: HASH,
    });
    expect(again.body?.batch?.id).toBe(first.body?.batch?.id);
    expect(first.body?.batch?.totals).toEqual([
      expect.objectContaining({ amount: "15500000", asset: "USDC" }),
    ]);

    const history = await harness.request("GET", "/v1/payouts", { cookies: auth.jar });
    expect(history.body?.batches).toHaveLength(1);
  });

  test("refuses a transaction missing a row's transfer", async () => {
    const { harness, auth } = await seed();
    paid(harness, {
      transfers: [{ from: SAFE, to: ALICE, amount: money(12_500_000n, "USDC") }],
    });

    const res = await post(harness, auth, "/v1/payouts", {
      chain: "base-sepolia",
      source: "safe",
      csv: CSV,
      transactionHash: HASH,
    });

    expect(res.status).toBe(400);
    const history = await harness.request("GET", "/v1/payouts", { cookies: auth.jar });
    expect(history.body?.batches).toEqual([]);
  });

  test("refuses a reverted transaction, or one to another address", async () => {
    const { harness, auth } = await seed();

    paid(harness, { succeeded: false });
    const reverted = await post(harness, auth, "/v1/payouts", {
      chain: "base-sepolia",
      source: "safe",
      csv: CSV,
      transactionHash: HASH,
    });
    paid(harness, { to: ALICE });
    const elsewhere = await post(harness, auth, "/v1/payouts", {
      chain: "base-sepolia",
      source: "safe",
      csv: CSV,
      transactionHash: HASH,
    });

    expect(reverted.status).toBe(400);
    expect(elsewhere.status).toBe(400);
  });

  test("a hash the chain does not know is a 404", async () => {
    const { harness, auth } = await seed();
    const res = await post(harness, auth, "/v1/payouts", {
      chain: "base-sepolia",
      source: "safe",
      csv: CSV,
      transactionHash: HASH,
    });
    expect(res.status).toBe(404);
  });
});

describe("payouts from a connected wallet", () => {
  const PAYER = `0x${"77".repeat(20)}`;
  const BATCHER = "0xfad1c3ec064ae52676ce874c2ba4d644ff2ad0b9";

  test("any wallet can prepare, with no managed Safe at all", async () => {
    const { harness, auth } = await seed({ managed: false });

    const res = await post(harness, auth, "/v1/payouts/prepare", {
      chain: "base-sepolia",
      source: "wallet",
      csv: CSV,
    });

    expect(res.status).toBe(200);
    const tx = res.body?.transaction;
    expect(tx.from).toBeUndefined();
    expect(tx.to).toBe(BATCHER);
    const call = decodeFunctionData({
      abi: parseAbi(["function payout(address[] tokens, address[] recipients, uint256[] amounts)"]),
      data: tx.data,
    });
    expect(call.args[1].map((to: string) => to.toLowerCase())).toEqual([ALICE, BOB]);
    expect(call.args[2]).toEqual([12_500_000n, 3_000_000n]);
    // One approval per token, for the batch total in it.
    expect(res.body?.approvals).toEqual([
      expect.objectContaining({ asset: "USDC", amount: "15500000" }),
    ]);
  });

  test("records a batch whose transfers left the sending wallet", async () => {
    const { harness, auth } = await seed({ managed: false });
    harness.payoutReceipts.set(HASH, {
      succeeded: true,
      from: PAYER,
      to: BATCHER,
      transfers: [
        { from: PAYER, to: ALICE, amount: money(12_500_000n, "USDC") },
        { from: PAYER, to: BOB, amount: money(3_000_000n, "USDC") },
      ],
    });

    const res = await post(harness, auth, "/v1/payouts", {
      chain: "base-sepolia",
      source: "wallet",
      csv: CSV,
      transactionHash: HASH,
    });

    expect(res.status).toBe(201);
    expect(res.body?.batch).toMatchObject({ sourceAddress: PAYER, submittedBy: PAYER });
  });

  test("refuses a wallet batch that did not go through the batcher", async () => {
    const { harness, auth } = await seed({ managed: false });
    harness.payoutReceipts.set(HASH, {
      succeeded: true,
      from: PAYER,
      to: ALICE,
      transfers: [
        { from: PAYER, to: ALICE, amount: money(12_500_000n, "USDC") },
        { from: PAYER, to: BOB, amount: money(3_000_000n, "USDC") },
      ],
    });

    const res = await post(harness, auth, "/v1/payouts", {
      chain: "base-sepolia",
      source: "wallet",
      csv: CSV,
      transactionHash: HASH,
    });

    expect(res.status).toBe(400);
  });
});
