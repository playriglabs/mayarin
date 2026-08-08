import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import { assertWebhookUrl, isPrivateAddress } from "../src/index.ts";

describe("webhook URL policy", () => {
  test("accepts a public https URL", () => {
    expect(assertWebhookUrl("https://merchant.example/webhooks").hostname).toBe("merchant.example");
  });

  test("rejects everything that is not https", () => {
    for (const url of [
      "http://merchant.example/webhooks",
      "ftp://merchant.example",
      "not a url",
      "wss://merchant.example",
    ]) {
      expect(() => assertWebhookUrl(url)).toThrow(ValidationError);
    }
  });

  test("rejects credentials in the URL", () => {
    expect(() => assertWebhookUrl("https://user:pass@merchant.example")).toThrow(ValidationError);
  });

  test("rejects localhost and private-network literals", () => {
    for (const url of [
      "https://localhost/hook",
      "https://api.localhost/hook",
      "https://internal.local/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.8/hook",
      "https://172.16.4.4/hook",
      "https://192.168.1.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://0.0.0.0/hook",
      "https://100.64.1.1/hook",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "https://[fe80::1]/hook",
      "https://[::ffff:127.0.0.1]/hook",
    ]) {
      expect(() => assertWebhookUrl(url)).toThrow(ValidationError);
    }
  });

  test("classifies resolved addresses, for the DNS check at the edge", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.20.30.40")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd12::1")).toBe(true);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("merchant.example")).toBe(false);
  });
});
