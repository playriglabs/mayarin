import { describe, expect, test } from "bun:test";
import { money, ValidationError } from "@mayarin/shared";
import { encodeAddressUri } from "../src/address-uri.ts";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const BASE_SEPOLIA = 84_532n;

describe("encodeAddressUri", () => {
  describe("native", () => {
    test("targets the recipient and carries the amount as value", () => {
      const uri = encodeAddressUri({
        recipient: RECIPIENT,
        chainId: BASE_SEPOLIA,
        amount: money(1_050_000_000_000_000n, "ETH"),
      });

      expect(uri).toBe(`ethereum:${RECIPIENT}@84532?value=1050000000000000`);
    });

    test("writes the amount in wei, never in decimals", () => {
      // ETH is 18 decimals, so `Money.amount` is already wei. A URI that
      // carried "0.00105" would be read as 105 wei by a strict parser.
      const uri = encodeAddressUri({
        recipient: RECIPIENT,
        chainId: BASE_SEPOLIA,
        amount: money(1_050_000_000_000_000n, "ETH"),
      });

      expect(uri).not.toContain(".");
    });
  });

  describe("ERC-20", () => {
    test("targets the token contract and passes the recipient as an argument", () => {
      const uri = encodeAddressUri({
        recipient: RECIPIENT,
        chainId: BASE_SEPOLIA,
        amount: money(3_000_000n, "USDC"),
        token: TOKEN,
      });

      expect(uri).toBe(`ethereum:${TOKEN}@84532/transfer?address=${RECIPIENT}&uint256=3000000`);
    });

    test("never puts the recipient in the target position", () => {
      // The failure this guards is silent and total: `ethereum:0xRECIPIENT`
      // with a token amount sends native value to the wrong place.
      const uri = encodeAddressUri({
        recipient: RECIPIENT,
        chainId: BASE_SEPOLIA,
        amount: money(3_000_000n, "USDC"),
        token: TOKEN,
      });

      expect(uri.startsWith(`ethereum:${TOKEN}@`)).toBe(true);
    });
  });

  test("distinguishes chains, so a Base URI is not a Base Sepolia one", () => {
    const mainnet = encodeAddressUri({
      recipient: RECIPIENT,
      chainId: 8_453n,
      amount: money(1n, "ETH"),
    });

    expect(mainnet).toContain("@8453?");
  });

  describe("refuses to emit a URI it cannot stand behind", () => {
    test("rejects a recipient that is not an address", () => {
      expect(() =>
        encodeAddressUri({
          recipient: "not-an-address",
          chainId: BASE_SEPOLIA,
          amount: money(1n, "ETH"),
        }),
      ).toThrow(ValidationError);
    });

    test("rejects an address of the wrong length", () => {
      expect(() =>
        encodeAddressUri({
          recipient: "0x1111",
          chainId: BASE_SEPOLIA,
          amount: money(1n, "ETH"),
        }),
      ).toThrow(ValidationError);
    });

    test("rejects a token that is not an address", () => {
      expect(() =>
        encodeAddressUri({
          recipient: RECIPIENT,
          chainId: BASE_SEPOLIA,
          amount: money(1n, "USDC"),
          token: "0xnope",
        }),
      ).toThrow(ValidationError);
    });

    test("rejects a zero amount — a payer cannot pay nothing", () => {
      expect(() =>
        encodeAddressUri({
          recipient: RECIPIENT,
          chainId: BASE_SEPOLIA,
          amount: money(0n, "ETH"),
        }),
      ).toThrow(ValidationError);
    });

    test("rejects a non-positive chain id", () => {
      expect(() =>
        encodeAddressUri({
          recipient: RECIPIENT,
          chainId: 0n,
          amount: money(1n, "ETH"),
        }),
      ).toThrow(ValidationError);
    });
  });
});
