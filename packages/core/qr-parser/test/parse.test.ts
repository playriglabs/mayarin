import { describe, expect, test } from "bun:test";
import { money } from "@mayarr/shared";
import { crc16, parseEmvTlv, withCrc } from "../src/emvco.ts";
import { QrParseError } from "../src/errors.ts";
import { parseQr } from "../src/parse.ts";

/** Builds one TLV field. */
function tlv(tag: string, value: string): string {
  return `${tag}${value.length.toString().padStart(2, "0")}${value}`;
}

const QRIS_MERCHANT_ACCOUNT = [
  tlv("00", "ID.CO.QRIS.WWW"),
  tlv("01", "9360091812345678901"),
  tlv("02", "ID1020017611473"),
  tlv("03", "UMI"),
].join("");

const ADDITIONAL_DATA = [tlv("05", "INV-001"), tlv("07", "T-01")].join("");

function dynamicQris(overrides: { amount?: string; currency?: string } = {}): string {
  return withCrc(
    [
      tlv("00", "01"),
      tlv("01", "12"),
      tlv("26", QRIS_MERCHANT_ACCOUNT),
      tlv("52", "5411"),
      tlv("53", overrides.currency ?? "360"),
      tlv("54", overrides.amount ?? "50000.00"),
      tlv("58", "ID"),
      tlv("59", "Warung Kopi Mayarr"),
      tlv("60", "Jakarta"),
      tlv("61", "12190"),
      tlv("62", ADDITIONAL_DATA),
    ].join(""),
  );
}

describe("crc16", () => {
  test("matches the CRC-16/CCITT-FALSE check vector", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("parseQr — dynamic QRIS", () => {
  const parsed = parseQr(dynamicQris());

  test("detects the scheme and initiation method", () => {
    expect(parsed.scheme).toBe("QRIS");
    expect(parsed.isStatic).toBe(false);
  });

  test("normalizes merchant identity", () => {
    expect(parsed.merchantName).toBe("Warung Kopi Mayarr");
    expect(parsed.merchantCity).toBe("Jakarta");
    expect(parsed.countryCode).toBe("ID");
    expect(parsed.merchantCategoryCode).toBe("5411");
    expect(parsed.postalCode).toBe("12190");
  });

  test("prefers the QRIS NMID over the merchant PAN", () => {
    expect(parsed.merchantId).toBe("ID1020017611473");
    expect(parsed.merchantAccounts[0]?.merchantPan).toBe("9360091812345678901");
    expect(parsed.merchantAccounts[0]?.merchantCriteria).toBe("UMI");
  });

  test("converts the amount into minor units of the QR's currency", () => {
    expect(parsed.currency).toBe("IDR");
    expect(parsed.amount).toEqual(money(5_000_000n, "IDR"));
  });

  test("extracts additional data", () => {
    expect(parsed.additionalData).toEqual({ referenceLabel: "INV-001", terminalLabel: "T-01" });
  });

  test("retains the raw payload for audit", () => {
    expect(parsed.raw).toBe(dynamicQris());
  });

  test("ignores surrounding whitespace from scanners", () => {
    expect(parseQr(`  ${dynamicQris()}\n`).raw).toBe(dynamicQris());
  });
});

describe("parseQr — static QRIS", () => {
  const payload = withCrc(
    [
      tlv("00", "01"),
      tlv("01", "11"),
      tlv("26", QRIS_MERCHANT_ACCOUNT),
      tlv("53", "360"),
      tlv("58", "ID"),
      tlv("59", "Warung Kopi Mayarr"),
      tlv("60", "Jakarta"),
    ].join(""),
  );

  test("carries no amount", () => {
    const parsed = parseQr(payload);
    expect(parsed.isStatic).toBe(true);
    expect(parsed.amount).toBeUndefined();
  });
});

describe("parseQr — non-QRIS EMVCo", () => {
  test("falls back to the card-scheme PAN as merchant id", () => {
    const payload = withCrc(
      [
        tlv("00", "01"),
        tlv("02", "1234567890123456"),
        tlv("53", "702"),
        tlv("58", "SG"),
        tlv("59", "Kopi SG"),
        tlv("60", "Singapore"),
      ].join(""),
    );

    const parsed = parseQr(payload);
    expect(parsed.scheme).toBe("EMVCO");
    expect(parsed.merchantId).toBe("1234567890123456");
    expect(parsed.currency).toBe("SGD");
  });
});

describe("parseQr — rejections", () => {
  test("rejects a corrupt checksum", () => {
    const payload = dynamicQris();
    const tampered = `${payload.slice(0, -1)}${payload.endsWith("0") ? "1" : "0"}`;
    expect(() => parseQr(tampered)).toThrow(QrParseError);
  });

  test("rejects a payload with no CRC field", () => {
    expect(() => parseQr(tlv("00", "01"))).toThrow(QrParseError);
  });

  test("rejects an empty payload", () => {
    expect(() => parseQr("   ")).toThrow(QrParseError);
  });

  test("rejects an unsupported payload format indicator", () => {
    const payload = withCrc([tlv("00", "02"), tlv("53", "360"), tlv("58", "ID")].join(""));
    expect(() => parseQr(payload)).toThrow(/payload format indicator/i);
  });

  test("rejects an unsupported currency", () => {
    expect(() => parseQr(dynamicQris({ currency: "978" }))).toThrow(
      /Unsupported transaction currency/,
    );
  });

  test("rejects an amount with more precision than the currency allows", () => {
    expect(() => parseQr(dynamicQris({ amount: "50000.123" }))).toThrow(
      /Invalid transaction amount/,
    );
  });

  test("rejects a payload without merchant account information", () => {
    const payload = withCrc(
      [
        tlv("00", "01"),
        tlv("53", "360"),
        tlv("58", "ID"),
        tlv("59", "Nameless"),
        tlv("60", "Jakarta"),
      ].join(""),
    );
    expect(() => parseQr(payload)).toThrow(/merchant account information/);
  });

  test("rejects a payload missing the merchant name", () => {
    const payload = withCrc(
      [
        tlv("00", "01"),
        tlv("26", QRIS_MERCHANT_ACCOUNT),
        tlv("53", "360"),
        tlv("58", "ID"),
        tlv("60", "Jakarta"),
      ].join(""),
    );
    expect(() => parseQr(payload)).toThrow(/merchant name/);
  });
});

describe("parseEmvTlv", () => {
  test("rejects a length that runs past the payload", () => {
    expect(() => parseEmvTlv(`${tlv("00", "01")}0199short`)).toThrow(QrParseError);
  });

  test("rejects a non-numeric tag", () => {
    expect(() => parseEmvTlv("XX02AB")).toThrow(QrParseError);
  });

  test("rejects duplicate tags at the same level", () => {
    const payload = withCrc(
      [
        tlv("00", "01"),
        tlv("59", "First"),
        tlv("59", "Second"),
        tlv("53", "360"),
        tlv("58", "ID"),
        tlv("60", "Jakarta"),
      ].join(""),
    );
    expect(() => parseQr(payload)).toThrow(/Duplicate EMVCo tag/);
  });
});
