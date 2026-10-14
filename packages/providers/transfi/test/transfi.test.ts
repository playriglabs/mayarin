import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { ConfigurationError, ProviderError } from "@mayarin/shared";
import {
  BelowMinimumError,
  chooseLocalCurrencyRail,
  createTransfiClient,
  detailsFor,
  type FetchLike,
  fiatAmountFor,
  instructionsOf,
  needsVerification,
  transfiSupportedPairs,
  transfiTokenCode,
  verifyWebhookSignature,
} from "../src/index.ts";

const config = {
  baseUrl: "https://sandbox-api.transfi.com",
  mid: "MID_TEST",
  username: "user",
  password: "pass",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createTransfiClient", () => {
  test("signs every request with basic auth and the mid header", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchFake: FetchLike = async (url, init) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return json({ data: [], pagination: { hasNext: false } });
    };

    await createTransfiClient(config, fetchFake).listPaymentMethods("PHP");

    const [call] = seen;
    expect(call?.headers.Authorization).toBe(`Basic ${btoa("user:pass")}`);
    expect(call?.headers.mid).toBe("MID_TEST");
    expect(call?.url).toContain("direction=deposit");
    expect(call?.url).toContain("currency=PHP");
  });

  test("reads the payer fields a method asks for", async () => {
    const fetchFake: FetchLike = async () =>
      json({
        data: [
          {
            name: "GCash",
            paymentCode: "gcash",
            paymentType: "local_wallet",
            minAmount: 100,
            maxAmount: 1_500_000,
            additionalDetails: {
              firstName: { type: "string" },
              phone: { type: "string" },
              phoneCode: { type: "string" },
            },
          },
        ],
        pagination: { hasNext: false },
      });

    const [method] = await createTransfiClient(config, fetchFake).listPaymentMethods("PHP");

    expect(method?.fields).toEqual(["firstName", "phone", "phoneCode"]);
  });

  test("carries the logo TransFi ships with a method", async () => {
    const fetchFake: FetchLike = async () =>
      json({
        data: [
          {
            name: "QRIS",
            paymentCode: "qris",
            paymentType: "local_wallet",
            minAmount: 1,
            maxAmount: 250_000_000,
            logoUrl: "https://cdn.example.com/qris.svg",
          },
          {
            name: "Other",
            paymentCode: "x",
            paymentType: "bank_transfer",
            minAmount: 1,
            maxAmount: 2,
          },
        ],
        pagination: { hasNext: false },
      });

    const methods = await createTransfiClient(config, fetchFake).listPaymentMethods("IDR");

    expect(methods[0]?.logoUrl).toBe("https://cdn.example.com/qris.svg");
    expect(methods[1]?.logoUrl).toBeNull();
  });

  test("follows pagination until the last page", async () => {
    const pages = [
      {
        data: [
          {
            name: "GCash",
            paymentCode: "gcash",
            paymentType: "local_wallet",
            minAmount: 100,
            maxAmount: 1_500_000,
          },
        ],
        pagination: { hasNext: true },
      },
      {
        data: [
          {
            name: "QRPH",
            paymentCode: "qrph",
            paymentType: "local_wallet",
            minAmount: 100,
            maxAmount: 1_500_000,
          },
        ],
        pagination: { hasNext: false },
      },
    ];
    let call = 0;
    const fetchFake: FetchLike = async () => json(pages[call++]);

    const methods = await createTransfiClient(config, fetchFake).listPaymentMethods("PHP");

    expect(methods.map((method) => method.code)).toEqual(["gcash", "qrph"]);
  });

  test("a 4xx is a non-retryable ProviderError carrying TransFi's code", async () => {
    const fetchFake: FetchLike = async () =>
      json({ error: { code: "COMPLIANCE_CHECK_FAILED", message: "not approved" } }, 409);

    const failure = await createTransfiClient(config, fetchFake)
      .createUser({
        firstName: "A",
        lastName: "B",
        country: "PH",
        dateOfBirth: "01-01-1990",
        email: "a@example.com",
        phone: "9171234567",
        phoneCode: "+63",
        address: { street: "1", city: "Manila", state: "NCR", postalCode: "1000" },
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).retryable).toBe(false);
    expect((failure as ProviderError).details.providerCode).toBe("COMPLIANCE_CHECK_FAILED");
  });

  test("a below-minimum refusal carries the real floor", async () => {
    const fetchFake: FetchLike = async () =>
      json(
        {
          error: {
            code: "QUOTES_MIN_AMOUNT_ERROR",
            message: "Minimum order amount is 91310 IDR",
            context: { details: [{ minLimit: 91310 }] },
          },
        },
        400,
      );

    const failure = await createTransfiClient(config, fetchFake)
      .quote({
        fiatCurrency: "IDR",
        fiatAmount: 50_000,
        cryptoCurrency: "USDCARB",
        paymentCode: "qris",
        paymentType: "local_wallet",
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BelowMinimumError);
    expect((failure as BelowMinimumError).minLimit).toBe(91_310);
  });

  test("an unverified contact is recognised from TransFi's nested codes", async () => {
    const fetchFake: FetchLike = async () =>
      json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Transfer Creation failed",
            context: {
              details: [
                { code: "PHONE_NOT_VERIFIED", message: "User phone not verified." },
                { code: "EMAIL_NOT_VERIFIED", message: "User email not verified." },
              ],
            },
          },
        },
        400,
      );

    const failure = await createTransfiClient(config, fetchFake)
      .createOrder({
        userId: "UX-1",
        partnerId: "pi_1",
        fiatCurrency: "IDR",
        fiatAmount: 100_000,
        paymentCode: "qris",
        paymentType: "local_wallet",
        cryptoCurrency: "USDCARB",
        walletAddress: "0x000000000000000000000000000000000000dEaD",
        successRedirectUrl: "https://example.com/ok",
        failureRedirectUrl: "https://example.com/fail",
        details: {},
      })
      .catch((error: unknown) => error);

    expect(needsVerification(failure)).toBe(true);
    expect(needsVerification(new Error("other"))).toBe(false);
  });

  test("a network failure is retryable", async () => {
    const fetchFake: FetchLike = async () => {
      throw new Error("socket hang up");
    };

    const failure = await createTransfiClient(config, fetchFake)
      .listPaymentMethods("PHP")
      .catch((error: unknown) => error);

    expect((failure as ProviderError).retryable).toBe(true);
  });

  test("an order names the wallet, our id and the token code", async () => {
    let body: Record<string, unknown> = {};
    const fetchFake: FetchLike = async (_url, init) => {
      body = JSON.parse(String(init.body));
      return json({
        status: "success",
        data: { orderId: "OR-1", payUrl: "https://pay.transfi.com/x" },
      });
    };

    const order = await createTransfiClient(config, fetchFake).createOrder({
      userId: "UX-1",
      partnerId: "pi_123",
      fiatCurrency: "PHP",
      fiatAmount: 1000,
      paymentCode: "gcash",
      paymentType: "local_wallet",
      cryptoCurrency: "USDCARB",
      walletAddress: "0x000000000000000000000000000000000000dEaD",
      successRedirectUrl: "https://example.com/ok",
      failureRedirectUrl: "https://example.com/fail",
      details: { firstName: "A", lastName: "B" },
      device: { userAgent: "UA", ip: "103.1.1.1" },
    });

    expect(order.orderId).toBe("OR-1");
    expect(order.instructions).toEqual({ kind: "redirect", url: "https://pay.transfi.com/x" });
    expect(body.headlessMode).toBe(true);
    const source = body.source as { additionalPaymentDetails: Record<string, unknown> };
    expect(source.additionalPaymentDetails.firstName).toBe("A");
    expect(source.additionalPaymentDetails.deviceDetails).toEqual({
      userAgent: "UA",
      ipInfo: { ip: "103.1.1.1" },
    });
    expect(body.partnerId).toBe("pi_123");
    expect((body.destination as Record<string, unknown>).walletAddress).toBe(
      "0x000000000000000000000000000000000000dEaD",
    );
    expect((body.destination as Record<string, unknown>).currency).toBe("USDCARB");
  });
});

describe("listDepositCurrencies", () => {
  test("follows pagination and returns the currency codes", async () => {
    const pages = [
      { data: [{ currency: "IDR" }, { currency: "PHP" }], pagination: { hasNext: true } },
      { data: [{ currency: "MYR" }], pagination: { hasNext: false } },
    ];
    let call = 0;
    const fetchFake: FetchLike = async (url) => {
      expect(url).toContain("direction=deposit");
      return json(pages[call++]);
    };

    const currencies = await createTransfiClient(config, fetchFake).listDepositCurrencies();

    expect(currencies).toEqual(["IDR", "PHP", "MYR"]);
  });
});

describe("getOrder", () => {
  test("reads status and what the order will deliver", async () => {
    const fetchFake: FetchLike = async (url) => {
      expect(url).toContain("/v3/orders/OR-1");
      return json({
        status: "success",
        data: {
          status: "asset_settled",
          destination: { currency: "USDCBASE", amount: "5.655218" },
        },
      });
    };

    const order = await createTransfiClient(config, fetchFake).getOrder("OR-1");

    expect(order).toEqual({
      status: "asset_settled",
      destinationCurrency: "USDCBASE",
      destinationAmount: 5.655218,
    });
  });
});

describe("simulateSettled", () => {
  test("posts asset_settled for the order, on the sandbox", async () => {
    let seen: { url: string; body: Record<string, unknown> } | undefined;
    const fetchFake: FetchLike = async (url, init) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return json({ status: "success", data: { code: "ORDER_STATUS_UPDATE_ACCEPTED" } });
    };

    await createTransfiClient(config, fetchFake).simulateSettled("OR-9");

    expect(seen?.url).toContain("/v3/simulation/order");
    expect(seen?.body).toEqual({ orderId: "OR-9", status: "asset_settled" });
  });

  test("refuses any host that is not the sandbox, without a request", async () => {
    let calls = 0;
    const fetchFake: FetchLike = async () => {
      calls += 1;
      return json({});
    };

    const failure = await createTransfiClient(
      { ...config, baseUrl: "https://api.transfi.com" },
      fetchFake,
    )
      .simulateSettled("OR-9")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConfigurationError);
    expect(calls).toBe(0);
  });
});

describe("detailsFor", () => {
  const contact = {
    firstName: "A",
    lastName: "B",
    email: "a@example.com",
    phone: "9171234567",
    phoneCode: "+63",
  };

  test("takes only what the method lists", () => {
    expect(detailsFor(["firstName", "lastName"], contact)).toEqual({
      details: { firstName: "A", lastName: "B" },
      missing: [],
    });
  });

  test("reports a field it was not given", () => {
    const { missing } = detailsFor(["firstName", "phone"], { firstName: "A" });
    expect(missing).toEqual(["phone"]);
  });

  test("a field nobody collects is missing, not guessed", () => {
    expect(detailsFor(["bankAccount"], contact).missing).toEqual(["bankAccount"]);
  });
});

describe("instructionsOf", () => {
  const payUrl = "https://pay.transfi.com/x";

  test("a QR string is drawn as a QR", () => {
    expect(instructionsOf(payUrl, { type: "qrCode", qrCode: "000201..." })).toEqual({
      kind: "qr",
      value: "000201...",
    });
  });

  test("a virtual account carries its bank", () => {
    expect(
      instructionsOf(payUrl, { type: "vaCode", vaCode: "5759", extra: { vaBank: "BCA" } }),
    ).toEqual({ kind: "va", code: "5759", bank: "BCA" });
  });

  test("anything it cannot draw falls back to the hosted page", () => {
    // DANA: TransFi's own redirect is a homepage, not a payment.
    expect(instructionsOf(payUrl, { type: "redirect" })).toEqual({ kind: "redirect", url: payUrl });
    expect(instructionsOf(payUrl, { type: "sandbox" })).toEqual({ kind: "redirect", url: payUrl });
    expect(instructionsOf(payUrl, undefined)).toEqual({ kind: "redirect", url: payUrl });
    expect(instructionsOf(payUrl, { type: "qrCode", qrCode: "" })).toEqual({
      kind: "redirect",
      url: payUrl,
    });
  });
});

describe("fiatAmountFor", () => {
  // 0.0156 coin per unit of fiat, less a fixed 0.22 network fee.
  const quote = async (fiat: number) => ({ destinationAmount: fiat * 0.0156 - 0.22 });

  test("returns an amount that delivers at least the required stablecoin", async () => {
    const { amount, delivered } = await fiatAmountFor({
      required: 10,
      probe: 1000,
      decimals: 2,
      quote,
    });

    expect(delivered).toBeGreaterThanOrEqual(10);
    expect((await quote(amount)).destinationAmount).toBe(delivered);
  });

  test("does not overshoot by more than a few percent", async () => {
    const { delivered } = await fiatAmountFor({ required: 10, probe: 1000, decimals: 2, quote });

    expect(delivered).toBeLessThan(10.6);
  });

  test("rounds up to the currency's precision", async () => {
    const { amount } = await fiatAmountFor({ required: 10, probe: 1000, decimals: 0, quote });

    expect(Number.isInteger(amount)).toBe(true);
  });

  test("starts from the floor a refusal reports instead of guessing upward", async () => {
    const seen: number[] = [];
    const floored = async (fiat: number) => {
      seen.push(fiat);
      return fiat < 91_310
        ? { destinationAmount: 0, belowMinimum: 91_310 }
        : { destinationAmount: fiat * 0.00006 };
    };

    const { amount } = await fiatAmountFor({ required: 5, probe: 1, decimals: 2, quote: floored });

    expect(seen[1]).toBe(91_310);
    expect(amount).toBeGreaterThanOrEqual(91_310);
  });

  test("refuses a quote with no output", async () => {
    const failure = await fiatAmountFor({
      required: 10,
      probe: 1,
      decimals: 2,
      quote: async () => ({ destinationAmount: 0 }),
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderError);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test";
  const body = '{"orderId":"OR-1","status":"asset_settled"}';
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  test("accepts the signature of the raw body", () => {
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  test("rejects a changed body, a wrong secret and a missing header", () => {
    expect(verifyWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyWebhookSignature(body, signature, "other")).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });
});

describe("transfiTokenCode", () => {
  test("maps the chains Mayarin settles on", () => {
    expect(transfiTokenCode("arbitrum", "USDC")).toBe("USDCARB");
    expect(transfiTokenCode("base", "USDC")).toBe("USDCBASE");
  });

  test("returns undefined for a pair TransFi does not list", () => {
    expect(transfiTokenCode("arbitrum-sepolia", "USDC")).toBeUndefined();
  });

  test("a testnet stands in for its mainnet only against the sandbox", () => {
    expect(transfiTokenCode("base-sepolia", "USDC", { sandbox: true })).toBe("USDCBASE");
    expect(transfiTokenCode("base-sepolia", "USDC", { sandbox: false })).toBeUndefined();
    expect(transfiTokenCode("ethereum-sepolia", "USDC")).toBeUndefined();
  });

  test("Solana is not offered in the sandbox, whose settlement there needs real funds", () => {
    expect(transfiTokenCode("solana-devnet", "USDC", { sandbox: true })).toBeUndefined();
    expect(transfiTokenCode("solana-devnet", "USDT", { sandbox: true })).toBeUndefined();
  });

  test("production lists no testnet in its supported pairs", () => {
    const production = transfiSupportedPairs({ sandbox: false });
    expect(production.some((pair) => pair.chain.endsWith("-sepolia"))).toBe(false);
    expect(production).toContainEqual({ chain: "base", asset: "USDC" });
    expect(transfiSupportedPairs({ sandbox: true })).toContainEqual({
      chain: "base-sepolia",
      asset: "USDC",
    });
  });
});

describe("chooseLocalCurrencyRail", () => {
  const rail = (chain: string, asset = "USDC", settlementAsset = "USDC") => ({
    chain,
    asset,
    settlementAsset,
  });

  test("honours the chain the merchant named", () => {
    const chosen = chooseLocalCurrencyRail([rail("base"), rail("arbitrum")], {
      sandbox: false,
      preferredChain: "arbitrum",
    });

    expect(chosen?.chain).toBe("arbitrum");
  });

  test("falls back when the named chain cannot be delivered to", () => {
    const chosen = chooseLocalCurrencyRail([rail("arc-testnet"), rail("base")], {
      sandbox: false,
      preferredChain: "arc-testnet",
    });

    expect(chosen?.chain).toBe("base");
  });

  test("prefers a rail that needs no conversion over a cheaper chain that does", () => {
    const chosen = chooseLocalCurrencyRail(
      [rail("base", "USDT", "USDC"), rail("ethereum", "USDC", "USDC")],
      { sandbox: false },
    );

    expect(chosen).toEqual(rail("ethereum", "USDC", "USDC"));
  });

  test("otherwise takes the cheaper chain", () => {
    const chosen = chooseLocalCurrencyRail([rail("ethereum"), rail("polygon"), rail("base")], {
      sandbox: false,
    });

    expect(chosen?.chain).toBe("base");
  });

  test("keeps the given order between equals", () => {
    const first = { ...rail("base"), id: "first" };
    const second = { ...rail("base"), id: "second" };

    expect(chooseLocalCurrencyRail([first, second], { sandbox: false })?.id).toBe("first");
  });

  test("offers nothing when no rail can be delivered to", () => {
    expect(
      chooseLocalCurrencyRail([rail("arc-testnet"), rail("solana-devnet")], { sandbox: true }),
    ).toBeUndefined();
  });

  test("a testnet is a candidate in the sandbox only", () => {
    expect(chooseLocalCurrencyRail([rail("base-sepolia")], { sandbox: true })?.chain).toBe(
      "base-sepolia",
    );
    expect(chooseLocalCurrencyRail([rail("base-sepolia")], { sandbox: false })).toBeUndefined();
  });
});
