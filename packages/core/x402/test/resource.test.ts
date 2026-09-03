import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import {
  authorizationWithinLock,
  buildPaymentRequired,
  checkStatically,
  selectRequirements,
} from "../src/index.ts";
import {
  atomic,
  bareResource,
  EXAMPLE_AUTHORIZATION,
  exampleResource,
  InMemoryResourceRepository,
  priced,
  USDC_ARC_TESTNET,
  USDC_BASE_SEPOLIA,
  withAccepted,
} from "../testing/index.ts";

const NOW = new Date("2026-09-03T09:00:00.000Z");

describe("buildPaymentRequired", () => {
  test("offers every priced asset as its own way to pay", () => {
    const resource = exampleResource({ accepts: [USDC_BASE_SEPOLIA, USDC_ARC_TESTNET] });
    const required = buildPaymentRequired(
      resource,
      [
        priced(USDC_BASE_SEPOLIA, atomic(11_500n, "USDC"), NOW, 60),
        priced(USDC_ARC_TESTNET, atomic(11_500n, "USDC"), NOW, 60),
      ],
      NOW,
    );

    expect(required.accepts.map((a) => a.network)).toEqual(["eip155:84532", "eip155:5042002"]);
    expect(required.accepts.map((a) => a.amount)).toEqual(["11500", "11500"]);
    expect(required.resource.url).toBe(resource.url);
  });

  // The price is the merchant's, in the merchant's currency. Nothing the payer
  // sees is denominated in it — that conversion is the product.
  test("advertises the quoted amount, not the merchant's price", () => {
    const resource = exampleResource();
    const required = buildPaymentRequired(
      resource,
      [priced(USDC_BASE_SEPOLIA, atomic(11_500n, "USDC"), NOW, 60)],
      NOW,
    );

    expect(resource.price.asset).toBe("IDR");
    expect(required.accepts[0]?.amount).toBe("11500");
    expect(required.accepts[0]?.asset).toBe(USDC_BASE_SEPOLIA.contract);
  });

  // The domain is recorded from the token, not defaulted, so it has to survive
  // into `extra` — a payer signs against whatever is here.
  test("carries the token's EIP-712 domain and transfer method into extra", () => {
    const required = buildPaymentRequired(
      exampleResource(),
      [priced(USDC_BASE_SEPOLIA, atomic(1n, "USDC"), NOW, 60)],
      NOW,
    );

    expect(required.accepts[0]?.extra).toEqual({
      name: "USDC",
      version: "2",
      assetTransferMethod: "eip3009",
    });
  });

  describe("maxTimeoutSeconds", () => {
    // The headline risk of the whole rail. A budget longer than the price lock
    // means holding a signed authorization against a price that has stopped
    // being honoured, which is how this repository reached ExpiredOrder and
    // then EXECUTION_EXHAUSTED the last time these two numbers could differ.
    test("is the quote lock when the lock is shorter than the merchant's ceiling", () => {
      const required = buildPaymentRequired(
        exampleResource({ maxTimeoutSeconds: 300 }),
        [priced(USDC_BASE_SEPOLIA, atomic(1n, "USDC"), NOW, 45)],
        NOW,
      );

      expect(required.accepts[0]?.maxTimeoutSeconds).toBe(45);
    });

    test("is the merchant's ceiling when the lock is longer", () => {
      const required = buildPaymentRequired(
        exampleResource({ maxTimeoutSeconds: 30 }),
        [priced(USDC_BASE_SEPOLIA, atomic(1n, "USDC"), NOW, 600)],
        NOW,
      );

      expect(required.accepts[0]?.maxTimeoutSeconds).toBe(30);
    });

    // One budget is advertised for every option, so it has to be the shortest —
    // otherwise the 402 promises a window during which one of the prices it
    // offers has already stopped being real.
    test("is the shortest lock on offer, not the one the payer might pick", () => {
      const required = buildPaymentRequired(
        exampleResource({ accepts: [USDC_BASE_SEPOLIA, USDC_ARC_TESTNET], maxTimeoutSeconds: 300 }),
        [
          priced(USDC_BASE_SEPOLIA, atomic(1n, "USDC"), NOW, 200),
          priced(USDC_ARC_TESTNET, atomic(1n, "USDC"), NOW, 20),
        ],
        NOW,
      );

      expect(required.accepts.map((a) => a.maxTimeoutSeconds)).toEqual([20, 20]);
    });

    test("refuses to advertise a price whose lock has already run out", () => {
      expect(() =>
        buildPaymentRequired(
          exampleResource(),
          [priced(USDC_BASE_SEPOLIA, atomic(1n, "USDC"), NOW, 0)],
          NOW,
        ),
      ).toThrow(/already expired/);
    });
  });

  test("refuses a price quoted in an asset the option does not accept", () => {
    expect(() =>
      buildPaymentRequired(
        exampleResource(),
        [priced(USDC_BASE_SEPOLIA, atomic(1n, "USDT"), NOW, 60)],
        NOW,
      ),
    ).toThrow(/is in USDT/);
  });

  test("refuses a resource with nothing to offer", () => {
    expect(() => buildPaymentRequired(exampleResource(), [], NOW)).toThrow(ValidationError);
  });

  // `exactOptionalPropertyTypes` distinguishes an absent field from one set to
  // undefined, and so does JSON: a `"description": null` on the wire is a
  // description, and a merchant who filled in only a URL did not write one.
  test("omits the optional resource fields the merchant left unset", () => {
    const required = buildPaymentRequired(
      bareResource(),
      [priced(USDC_BASE_SEPOLIA, atomic(1n, "USDC"), NOW, 60)],
      NOW,
    );

    expect(Object.keys(required.resource)).toEqual(["url"]);
  });
});

describe("selectRequirements", () => {
  const required = buildPaymentRequired(
    exampleResource({ accepts: [USDC_BASE_SEPOLIA, USDC_ARC_TESTNET] }),
    [
      priced(USDC_BASE_SEPOLIA, atomic(11_500n, "USDC"), NOW, 60),
      priced(USDC_ARC_TESTNET, atomic(11_500n, "USDC"), NOW, 60),
    ],
    NOW,
  );

  test("finds our copy of the option the payer chose", () => {
    const payment = withAccepted({ network: "eip155:5042002", asset: USDC_ARC_TESTNET.contract });

    expect(selectRequirements(required, payment).network).toBe("eip155:5042002");
  });

  // The reason this function exists rather than reading `payment.accepted`
  // directly: a payer who lowers the amount before signing must not have that
  // amount used as the thing their signature is checked against.
  test("returns our amount, not the payer's", () => {
    const payment = withAccepted({
      network: "eip155:84532",
      asset: USDC_BASE_SEPOLIA.contract,
      amount: "1",
    });

    const ours = selectRequirements(required, payment);

    expect(ours.amount).toBe("11500");
    expect(checkStatically(payment, ours, NOW)).toBe("invalid_amount");
  });

  test("matches an asset address that differs only by checksum case", () => {
    const payment = withAccepted({
      network: "eip155:84532",
      asset: USDC_BASE_SEPOLIA.contract.toLowerCase(),
    });

    expect(selectRequirements(required, payment).asset).toBe(USDC_BASE_SEPOLIA.contract);
  });

  test("refuses an option this resource does not offer", () => {
    const payment = withAccepted({ network: "eip155:296", asset: USDC_BASE_SEPOLIA.contract });

    expect(() => selectRequirements(required, payment)).toThrow(/does not accept/);
  });
});

describe("authorizationWithinLock", () => {
  const lock = new Date(1_740_672_154 * 1000);

  test("accepts an authorization expiring before the lock does", () => {
    expect(authorizationWithinLock(1_740_672_100n, lock)).toBe(true);
  });

  test("accepts one expiring exactly with the lock", () => {
    expect(authorizationWithinLock(BigInt(EXAMPLE_AUTHORIZATION.validBefore), lock)).toBe(true);
  });

  // Nothing stops a payer signing a validBefore far past the budget the 402
  // advertised. Holding that authorization would mean settling against a price
  // that is no longer honoured.
  test("refuses one that outlives the price it was signed against", () => {
    expect(authorizationWithinLock(1_740_675_000n, lock)).toBe(false);
  });
});

describe("InMemoryResourceRepository", () => {
  test("round-trips a resource by id", async () => {
    const repository = new InMemoryResourceRepository();
    const resource = exampleResource();
    await repository.save(resource);

    expect(await repository.findById(resource.id)).toEqual(resource);
  });

  test("replaces rather than duplicates on a second save of the same id", async () => {
    const repository = new InMemoryResourceRepository();
    await repository.save(exampleResource());
    await repository.save(exampleResource({ maxTimeoutSeconds: 120 }));

    const listed = await repository.listByMerchant("mer_example");

    expect(listed).toHaveLength(1);
    expect(listed[0]?.maxTimeoutSeconds).toBe(120);
  });

  test("does not leak one merchant's resources to another", async () => {
    const repository = new InMemoryResourceRepository();
    await repository.save(exampleResource());
    await repository.save(exampleResource({ id: "res_other", merchantId: "mer_other" }));

    expect(await repository.listByMerchant("mer_other")).toHaveLength(1);
  });

  test("returns undefined for a resource that does not exist", async () => {
    expect(await new InMemoryResourceRepository().findById("res_nope")).toBeUndefined();
  });
});
