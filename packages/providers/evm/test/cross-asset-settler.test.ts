/**
 * `EvmCrossAssetSettler` (#211) — what it reads back off a receipt.
 *
 * The interesting cases are all about which logs count. A swap receipt carries
 * transfers from pools, routers and the payer's own token, and on Arc it
 * carries the *same* movement twice because USDC has a native view and an
 * ERC-20 view over one balance. Summing every `Transfer` is right on Base and
 * double on Arc, which is the worst way to be wrong.
 */

import { describe, expect, test } from "bun:test";
import type { RouteRequest } from "@mayarin/execution";
import { money } from "@mayarin/shared";
import type { CrossAssetSwapRequest } from "@mayarin/x402";
import { type Address, encodeEventTopics, getAddress, type Hex, pad, parseAbi, toHex } from "viem";
import { EvmCrossAssetSettler } from "../src/cross-asset-settler.ts";

const OPERATOR = getAddress("0x209693Bc6afc0C5328bA36FaF03C514EF312287C");
const MERCHANT = getAddress("0xe5DD11a0579C0ab6a60B8263277c174cC8Eb675E");
const POOL = getAddress("0x1111111111111111111111111111111111111111");
const ROUTER = getAddress("0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4");
const EURC = getAddress("0x808456652fdb597867f38412077A9182bf77359F");
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
/** Arc's native view of the same USDC balance — a different contract, same money. */
const USDC_NATIVE_VIEW = getAddress("0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfE");
const SWAP_TX = `0x${"cd".repeat(32)}`;

const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function transferLog(token: Address, from: Address, to: Address, value: bigint) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from, to } }),
    data: pad(toHex(value)) as Hex,
  };
}

const REQUEST: CrossAssetSwapRequest = {
  chain: "base-sepolia",
  held: money(20_101n, "EURC"),
  exactOut: money(20_000n, "USDC"),
  recipient: MERCHANT,
};

function settler(
  options: {
    readonly logs?: readonly ReturnType<typeof transferLog>[];
    readonly status?: "success" | "reverted";
    readonly allowance?: bigint;
    readonly expectedIn?: bigint;
  } = {},
) {
  const sent: { to: string; data: string }[] = [];

  const publicClient = {
    async getTransactionCount() {
      return 7;
    },
    async readContract() {
      return options.allowance ?? 2n ** 255n;
    },
    async waitForTransactionReceipt() {
      return {
        status: options.status ?? "success",
        logs: options.logs ?? [
          transferLog(EURC, OPERATOR, POOL, 19_980n),
          transferLog(USDC, POOL, MERCHANT, 20_000n),
        ],
      };
    },
  };

  const walletClient = {
    async sendTransaction({ to, data }: { to: string; data: string }) {
      sent.push({ to, data });
      return SWAP_TX;
    },
  };

  const routed: RouteRequest[] = [];

  const instance = new EvmCrossAssetSettler({
    clients: {
      "base-sepolia": { publicClient: publicClient as any, walletClient: walletClient as any },
    },
    account: { address: OPERATOR } as any,
    routes: {
      name: "uniswap",
      async route(request) {
        routed.push(request);
        return {
          router: ROUTER,
          callData: "0xdeadbeef",
          // Deliberately below the authorization: a quote is an estimate, and
          // an estimate must not be what bounds the spend.
          expectedIn: money(options.expectedIn ?? 19_980n, request.payerAsset),
          source: "uniswap",
        };
      },
    },
    tokens: { "base-sepolia": { EURC, USDC } },
    confirmations: { "base-sepolia": 1 },
  });

  return { settler: instance, sent, routed };
}

describe("confirming a cross-asset swap", () => {
  test("reads what was spent and what the merchant received", async () => {
    const { settler: instance } = settler();

    const swap = await instance.confirm(SWAP_TX, REQUEST);

    expect(swap.spent).toEqual(money(19_980n, "EURC"));
    expect(swap.delivered).toEqual(money(20_000n, "USDC"));
  });

  test("counts one Arc movement once, not once per view", async () => {
    // Arc's own currency is USDC, so a single transfer writes a `Transfer` on
    // the native view as well as on the ERC-20 one. Summing both would report
    // 40000 delivered against a 20000 invoice — and then refuse the payment for
    // over-delivering, on a swap that was correct.
    const { settler: instance } = settler({
      logs: [
        transferLog(EURC, OPERATOR, POOL, 19_980n),
        transferLog(USDC, POOL, MERCHANT, 20_000n),
        transferLog(USDC_NATIVE_VIEW, POOL, MERCHANT, 20_000n),
      ],
    });

    const swap = await instance.confirm(SWAP_TX, REQUEST);

    expect(swap.delivered).toEqual(money(20_000n, "USDC"));
  });

  test("ignores payer-asset transfers the operator did not make", async () => {
    // A pool paying another pool inside the same route is not the operator
    // spending the payer's authorization.
    const { settler: instance } = settler({
      logs: [
        transferLog(EURC, OPERATOR, POOL, 19_980n),
        transferLog(EURC, POOL, ROUTER, 500n),
        transferLog(USDC, POOL, MERCHANT, 20_000n),
      ],
    });

    const swap = await instance.confirm(SWAP_TX, REQUEST);

    expect(swap.spent).toEqual(money(19_980n, "EURC"));
  });

  test("refuses a swap that delivered less than the invoice", async () => {
    const { settler: instance } = settler({
      logs: [
        transferLog(EURC, OPERATOR, POOL, 19_980n),
        transferLog(USDC, POOL, MERCHANT, 19_900n),
      ],
    });

    // A shortfall is not a settled payment, and reporting it would let a caller
    // record a merchant as paid for money they did not get.
    await expect(instance.confirm(SWAP_TX, REQUEST)).rejects.toThrow(/not the invoiced 20000/);
  });

  test("refuses a swap that spent more than the payer authorised", async () => {
    // Cannot happen against a route bounded by `amountInMaximum`, which is why
    // it is worth asserting: the surplus is `held − spent`, so a `spent` above
    // the authorization would post a negative balance to the payer's name and
    // report a payment nobody signed for as settled.
    const { settler: instance } = settler({
      logs: [
        transferLog(EURC, OPERATOR, POOL, 20_500n),
        transferLog(USDC, POOL, MERCHANT, 20_000n),
      ],
    });

    await expect(instance.confirm(SWAP_TX, REQUEST)).rejects.toThrow(
      /spent 20500 of EURC, more than the 20101 authorised/,
    );
  });

  test("refuses a swap that paid somebody else", async () => {
    const { settler: instance } = settler({
      logs: [transferLog(EURC, OPERATOR, POOL, 19_980n), transferLog(USDC, POOL, POOL, 20_000n)],
    });

    await expect(instance.confirm(SWAP_TX, REQUEST)).rejects.toThrow(/delivered 0 of USDC/);
  });

  test("refuses a reverted swap", async () => {
    const { settler: instance } = settler({ status: "reverted" });

    await expect(instance.confirm(SWAP_TX, REQUEST)).rejects.toThrow(/reverted on base-sepolia/);
  });
});

describe("sending a cross-asset swap", () => {
  test("approves the router first when the allowance is short", async () => {
    const { settler: instance, sent } = settler({ allowance: 0n });

    await instance.send(REQUEST);

    // The approval has to be mined before the swap can spend, so it goes first
    // and is waited on — unlike the swap, which returns as soon as it has a
    // hash so the caller can persist it.
    expect(sent).toHaveLength(2);
    expect(sent[0]?.to).toBe(EURC);
    expect(sent[1]?.to).toBe(ROUTER);
    expect(sent[1]?.data).toBe("0xdeadbeef");
  });

  test("sends only the swap when the router is already approved", async () => {
    const { settler: instance, sent } = settler();

    await instance.send(REQUEST);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(ROUTER);
  });

  test("bounds the swap by the authorization, never by the quote", async () => {
    // The manipulated-quote case. `amountInMaximum` comes from what the payer
    // signed, so a route source that understates — stale, thin, or lying —
    // moves what the swap is expected to cost and not one unit of what it is
    // allowed to cost. A quote at 1 EURC would still bound the router at 20101.
    const { settler: instance, routed } = settler({ expectedIn: 1n });

    await instance.send(REQUEST);

    expect(routed).toHaveLength(1);
    expect(routed[0]?.maxIn).toEqual(REQUEST.held);
    expect(routed[0]?.exactOut).toEqual(REQUEST.exactOut);
  });

  test("routes again to send rather than reusing what it planned", async () => {
    // A route commits to a fill and goes stale faster than a price does, so the
    // one that bounded the payment is not the one that executes it — and both
    // are bounded by the same authorization either way.
    const { settler: instance, routed } = settler();

    await instance.plan(REQUEST);
    await instance.send(REQUEST);

    expect(routed).toHaveLength(2);
    expect(routed[1]?.maxIn).toEqual(REQUEST.held);
  });

  test("plans through the route source without sending anything", async () => {
    const { settler: instance, sent } = settler();

    expect(await instance.plan(REQUEST)).toEqual(money(19_980n, "EURC"));
    expect(sent).toHaveLength(0);
  });
});
