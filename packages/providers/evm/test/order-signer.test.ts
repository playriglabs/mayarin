import { describe, expect, test } from "bun:test";
import { ORDER_TYPES, orderTypedData } from "@mayarin/quote";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import vectors from "../../../contracts/abis/vectors/order-hash.json" with { type: "json" };
import { LocalOrderSigner } from "../src/order-signer.ts";

const PRIVATE_KEY = `0x${"44".repeat(32)}` as const;

const domain = {
  chainId: BigInt(vectors.domain.chainId),
  verifyingContract: vectors.domain.verifyingContract as `0x${string}`,
};

const order = {
  intentId: vectors.order.intentId as `0x${string}`,
  minOut: BigInt(vectors.order.minOut),
  fee: BigInt(vectors.order.fee),
  merchantSafe: vectors.order.merchantSafe as `0x${string}`,
  refundTo: vectors.order.refundTo as `0x${string}`,
  deadline: BigInt(vectors.order.deadline),
};

describe("LocalOrderSigner", () => {
  test("signs the digest the contract verifies — recovery lands on the signer", async () => {
    // The whole point of the port: a signature must recover to the address the
    // contract holds in its `signer` role. Signing the wrong digest still
    // produces 65 valid-looking bytes, so this is the assertion that matters.
    const signer = new LocalOrderSigner(PRIVATE_KEY);
    const typedData = orderTypedData(domain, order);

    const signature = await signer.sign(typedData);

    expect(
      await recoverTypedDataAddress({
        domain: typedData.domain,
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
        signature,
      }),
    ).toBe(await signer.address());
  });

  test("the signed digest is the one pinned in the order-hash vectors", async () => {
    // Ties the signer to the same committed fixture `PaymentRouter.t.sol` and
    // the quote package both re-derive, so a domain or field drift fails here
    // too rather than only on-chain.
    const signer = new LocalOrderSigner(PRIVATE_KEY);
    const signature = await signer.sign(orderTypedData(domain, order));

    const account = privateKeyToAccount(PRIVATE_KEY);
    const overDigest = await account.sign({ hash: vectors.digest as `0x${string}` });

    expect(signature).toBe(overDigest);
  });

  test("exposes the address derived from its key", async () => {
    const signer = new LocalOrderSigner(PRIVATE_KEY);
    expect(await signer.address()).toBe(privateKeyToAccount(PRIVATE_KEY).address);
  });
});
