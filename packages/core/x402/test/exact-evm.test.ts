import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import {
  assetTransferMethodOf,
  checkStatically,
  domainOf,
  eip3009PayloadOf,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from "../src/scheme/exact-evm.ts";
import {
  EXAMPLE_AUTHORIZATION,
  EXAMPLE_PAYMENT_PAYLOAD,
  EXAMPLE_REQUIREMENTS,
  EXAMPLE_WITHIN_WINDOW,
  withAccepted,
  withAuthorization,
  withoutExtra,
  withRequirements,
} from "../testing/fixtures.ts";

describe("TransferWithAuthorization types", () => {
  // Field order is part of the EIP-712 type hash. Reordering this array yields
  // a different digest, so every signature stops verifying against a token that
  // is behaving perfectly correctly — and nothing else in the system notices.
  test("matches the specification's field order exactly", () => {
    expect(TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization.map((f) => f.name)).toEqual([
      "from",
      "to",
      "value",
      "validAfter",
      "validBefore",
      "nonce",
    ]);
  });

  test("matches the specification's field types exactly", () => {
    expect(TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization.map((f) => f.type)).toEqual([
      "address",
      "address",
      "uint256",
      "uint256",
      "uint256",
      "bytes32",
    ]);
  });
});

describe("domainOf", () => {
  test("takes the token's name and version from extra", () => {
    expect(domainOf(EXAMPLE_REQUIREMENTS, 84_532)).toEqual({
      name: "USDC",
      version: "2",
      chainId: 84_532,
      verifyingContract: EXAMPLE_REQUIREMENTS.asset,
    });
  });

  // A guessed {"USDC","2"} would produce a domain separator that differs from
  // the contract's on any token that is not USDC v2 — a signature that is
  // valid, that the token rejects, and that looks like a payer error.
  test.each([
    ["no extra at all", withoutExtra()],
    ["extra without version", withRequirements({ extra: { name: "USDC" } })],
    ["extra without name", withRequirements({ extra: { version: "2" } })],
  ])("refuses to guess when there is %s", (_label, requirements) => {
    expect(() => domainOf(requirements, 84_532)).toThrow(ValidationError);
  });
});

describe("assetTransferMethodOf", () => {
  test("defaults to eip3009 as the specification prescribes", () => {
    expect(assetTransferMethodOf(withRequirements({ extra: { name: "USDC", version: "2" } }))).toBe(
      "eip3009",
    );
  });

  test("honours a stated method", () => {
    expect(
      assetTransferMethodOf(
        withRequirements({ extra: { name: "USDC", version: "2", assetTransferMethod: "permit2" } }),
      ),
    ).toBe("permit2");
  });

  test("rejects a method it does not recognise", () => {
    expect(() =>
      assetTransferMethodOf(
        withRequirements({ extra: { name: "USDC", version: "2", assetTransferMethod: "magic" } }),
      ),
    ).toThrow(ValidationError);
  });
});

describe("eip3009PayloadOf", () => {
  test("reads the signature and authorization", () => {
    expect(eip3009PayloadOf(EXAMPLE_PAYMENT_PAYLOAD).authorization).toEqual(EXAMPLE_AUTHORIZATION);
  });

  test("rejects a payload carrying neither", () => {
    expect(() => eip3009PayloadOf({ ...EXAMPLE_PAYMENT_PAYLOAD, payload: {} })).toThrow(
      ValidationError,
    );
  });
});

describe("checkStatically", () => {
  test("passes the specification's own example inside its window", () => {
    expect(
      checkStatically(EXAMPLE_PAYMENT_PAYLOAD, EXAMPLE_REQUIREMENTS, EXAMPLE_WITHIN_WINDOW),
    ).toBeUndefined();
  });

  // The payer echoes back the requirements they chose. These four cases are the
  // whole reason the echo is compared against our own copy: without them a
  // payer signs for a cheaper amount, a different asset, or their own address
  // as the recipient, and the facilitator settles exactly what was signed.
  test.each([
    ["network", withAccepted({ network: "eip155:8453" }), "invalid_network"],
    ["asset", withAccepted({ asset: `0x${"11".repeat(20)}` }), "invalid_asset"],
    ["recipient", withAccepted({ payTo: `0x${"22".repeat(20)}` }), "invalid_recipient"],
    ["amount", withAccepted({ amount: "1" }), "invalid_amount"],
  ] as const)("rejects an echoed %s that differs from the requirements", (_f, payment, reason) => {
    expect(checkStatically(payment, EXAMPLE_REQUIREMENTS, EXAMPLE_WITHIN_WINDOW)).toBe(reason);
  });

  // A payer can echo the requirements perfectly and sign something else. The
  // authorization is what the token executes, so it is checked against our
  // requirements rather than against the echo.
  test("rejects an authorization paying someone other than the merchant", () => {
    const payment = withAuthorization({ to: `0x${"33".repeat(20)}` });

    expect(checkStatically(payment, EXAMPLE_REQUIREMENTS, EXAMPLE_WITHIN_WINDOW)).toBe(
      "invalid_recipient",
    );
  });

  test("rejects an authorization for less than the requirements state", () => {
    const payment = withAuthorization({ value: "1" });

    expect(checkStatically(payment, EXAMPLE_REQUIREMENTS, EXAMPLE_WITHIN_WINDOW)).toBe(
      "invalid_amount",
    );
  });

  test("accepts a recipient that differs only by checksum case", () => {
    const payment = withAuthorization({ to: EXAMPLE_AUTHORIZATION.to.toLowerCase() });

    expect(checkStatically(payment, EXAMPLE_REQUIREMENTS, EXAMPLE_WITHIN_WINDOW)).toBeUndefined();
  });

  // EIP-3009 windows are exclusive at both ends — the token requires
  // validAfter < now < validBefore. Matching that here means a payment this
  // function accepts is not one the token then reverts.
  test("treats the boundary seconds the way the token does", () => {
    const at = (seconds: number) => new Date(seconds * 1000);

    expect(checkStatically(EXAMPLE_PAYMENT_PAYLOAD, EXAMPLE_REQUIREMENTS, at(1_740_672_089))).toBe(
      "authorization_not_yet_valid",
    );
    expect(checkStatically(EXAMPLE_PAYMENT_PAYLOAD, EXAMPLE_REQUIREMENTS, at(1_740_672_154))).toBe(
      "expired_authorization",
    );
    expect(
      checkStatically(EXAMPLE_PAYMENT_PAYLOAD, EXAMPLE_REQUIREMENTS, at(1_740_672_090)),
    ).toBeUndefined();
    expect(
      checkStatically(EXAMPLE_PAYMENT_PAYLOAD, EXAMPLE_REQUIREMENTS, at(1_740_672_153)),
    ).toBeUndefined();
  });

  test.each([
    ["a signature of the wrong length", withAuthorization({}), { signature: "0xdead" }],
  ] as const)("rejects %s", (_label, base, overrides) => {
    const payment = { ...base, payload: { ...base.payload, ...overrides } };

    expect(checkStatically(payment, EXAMPLE_REQUIREMENTS, EXAMPLE_WITHIN_WINDOW)).toBe(
      "invalid_signature",
    );
  });

  test.each([
    ["a from address that is not an address", { from: "0xnope" }],
    ["a nonce that is not 32 bytes", { nonce: "0x01" }],
  ] as const)("rejects %s", (_label, overrides) => {
    expect(
      checkStatically(withAuthorization(overrides), EXAMPLE_REQUIREMENTS, EXAMPLE_WITHIN_WINDOW),
    ).toBe("invalid_signature");
  });

  test("rejects a scheme it does not implement", () => {
    const payment = withAccepted({ scheme: "upto" });

    expect(
      checkStatically(payment, withRequirements({ scheme: "upto" }), EXAMPLE_WITHIN_WINDOW),
    ).toBe("invalid_scheme");
  });

  // permit2 is a real method this package does not yet settle. Saying so is not
  // the same as saying the payment is malformed, and a payer's client can act
  // on the difference.
  test("names an unimplemented transfer method rather than calling it invalid", () => {
    const extra = { name: "USDC", version: "2", assetTransferMethod: "permit2" };
    const requirements = withRequirements({ extra });
    const payment = withAccepted({ extra });

    expect(checkStatically(payment, requirements, EXAMPLE_WITHIN_WINDOW)).toBe(
      "unsupported_asset_transfer_method",
    );
  });
});
