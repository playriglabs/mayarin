import { describe, expect, test } from "bun:test";
import { ORDER_TYPES, type OrderTypedData } from "@mayarin/quote";
import { ProviderError } from "@mayarin/shared";
import { hashTypedData, recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assembleSignature, TurnkeyOrderSigner } from "../src/adapter.ts";
import { ApiKeyStamper, type TurnkeyStamper } from "../src/stamper.ts";

const SIGNER_ADDRESS = "0x000000000000000000000000000000000000a11c" as const;

const typedData: OrderTypedData = {
  domain: {
    name: "Mayarin PaymentRouter",
    version: "1",
    chainId: 84_532n,
    verifyingContract: "0x00000000000000000000000000000000000c0de5",
  },
  types: ORDER_TYPES,
  primaryType: "Order",
  message: {
    intentId: "0x0000000000000000000000000000000000000000000000000000000000000001",
    settlementToken: "0x000000000000000000000000000000000000c0de",
    minOut: 100_000_000n,
    fee: 1_000_000n,
    merchantSafe: "0x000000000000000000000000000000000000bEEF",
    refundTo: "0x000000000000000000000000000000000000cafE",
    deadline: 57_005n,
  },
};

class FakeStamper implements TurnkeyStamper {
  readonly stamped: string[] = [];
  async stamp(body: string): Promise<string> {
    this.stamped.push(body);
    return "fake-stamp";
  }
}

function signerWith(
  handler: (request: Request) => Response | Promise<Response>,
  stamper: TurnkeyStamper = new FakeStamper(),
): TurnkeyOrderSigner {
  return new TurnkeyOrderSigner({
    organizationId: "org-1",
    signWith: "key-1",
    signerAddress: SIGNER_ADDRESS,
    stamper,
    fetchFn: ((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(handler(new Request(input, init)))) as typeof fetch,
  });
}

function activity(result: { r: string; s: string; v: string }): Response {
  return Response.json({
    activity: { status: "ACTIVITY_STATUS_COMPLETED", result: { signRawPayloadResult: result } },
  });
}

describe("TurnkeyOrderSigner", () => {
  test("signs the EIP-712 digest, and the signature recovers to the signing key", async () => {
    // Stand in for the enclave: a local key produces the r/s/v Turnkey would.
    const account = privateKeyToAccount(`0x${"22".repeat(32)}`);
    const digest = hashTypedData(typedData);
    const local = await account.sign({ hash: digest });
    const r = local.slice(2, 66);
    const s = local.slice(66, 130);
    const v = local.slice(130, 132);

    let sentPayload: string | undefined;
    const signer = signerWith(async (request) => {
      const body = (await request.json()) as { parameters: { payload: string } };
      sentPayload = body.parameters.payload;
      return activity({ r, s, v });
    });

    const signature = await signer.sign(typedData);

    expect(sentPayload).toBe(digest);
    expect(await recoverAddress({ hash: digest, signature })).toBe(account.address);
  });

  test("sends the payload unhashed — Turnkey must not hash the digest again", async () => {
    let parameters: Record<string, unknown> = {};
    const signer = signerWith(async (request) => {
      const body = (await request.json()) as { parameters: Record<string, unknown> };
      parameters = body.parameters;
      return activity({ r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: "00" });
    });

    await signer.sign(typedData);

    expect(parameters.hashFunction).toBe("HASH_FUNCTION_NO_OP");
    expect(parameters.encoding).toBe("PAYLOAD_ENCODING_HEXADECIMAL");
  });

  test("stamps the exact body it sends", async () => {
    const stamper = new FakeStamper();
    const signer = signerWith(
      async () => activity({ r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: "00" }),
      stamper,
    );

    await signer.sign(typedData);

    expect(stamper.stamped).toHaveLength(1);
    expect(JSON.parse(stamper.stamped[0] ?? "{}").organizationId).toBe("org-1");
  });

  test("a pending activity is a ProviderError, not a silent bad signature", async () => {
    const signer = signerWith(() =>
      Response.json({ activity: { status: "ACTIVITY_STATUS_PENDING" } }),
    );
    await expect(signer.sign(typedData)).rejects.toThrow(ProviderError);
  });

  test("an HTTP failure surfaces as a ProviderError", async () => {
    const signer = signerWith(() => new Response("nope", { status: 403 }));
    await expect(signer.sign(typedData)).rejects.toThrow(ProviderError);
  });
});

describe("assembleSignature", () => {
  test("lifts a recovery id into Ethereum's 27/28", () => {
    const r = "11".repeat(32);
    const s = "22".repeat(32);
    expect(assembleSignature(r, s, "00")).toBe(`0x${r}${s}1b`);
    expect(assembleSignature(r, s, "01")).toBe(`0x${r}${s}1c`);
  });

  test("passes through a v that is already 27/28", () => {
    const r = "11".repeat(32);
    const s = "22".repeat(32);
    expect(assembleSignature(r, s, "1b")).toBe(`0x${r}${s}1b`);
  });

  test("rejects an out-of-range recovery id rather than emitting a bad signature", () => {
    expect(() => assembleSignature("11".repeat(32), "22".repeat(32), "05")).toThrow(ProviderError);
  });
});

describe("ApiKeyStamper", () => {
  test("produces a base64url envelope naming the P-256 scheme", async () => {
    const stamper = new ApiKeyStamper({
      apiPublicKey: "02".padEnd(66, "a"),
      apiPrivateKey: "33".repeat(32),
    });

    const stamp = await stamper.stamp('{"hello":"world"}');

    expect(stamp).not.toContain("+");
    expect(stamp).not.toContain("/");
    expect(stamp).not.toContain("=");
    const envelope = JSON.parse(atob(stamp.replace(/-/g, "+").replace(/_/g, "/")));
    expect(envelope.scheme).toBe("SIGNATURE_SCHEME_TK_API_P256");
    expect(envelope.signature).toMatch(/^30[0-9a-f]+$/); // DER SEQUENCE
  });

  test("signs the body — a different body gives a different stamp", async () => {
    const stamper = new ApiKeyStamper({
      apiPublicKey: "02".padEnd(66, "a"),
      apiPrivateKey: "33".repeat(32),
    });
    expect(await stamper.stamp('{"a":1}')).not.toBe(await stamper.stamp('{"a":2}'));
  });
});
