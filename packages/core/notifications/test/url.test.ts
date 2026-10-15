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

  test("refuses any port but 443", () => {
    expect(() => assertWebhookUrl("https://merchant.example:8443/hook")).toThrow(ValidationError);
    expect(() => assertWebhookUrl("https://merchant.example:443/hook")).not.toThrow();
  });

  test("classifies every private and reserved form, IPv4 and IPv6", () => {
    for (const address of [
      "0.0.0.0",
      "198.18.0.1",
      "192.0.0.8",
      "192.0.2.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "::",
      "0:0:0:0:0:0:0:1",
      "fe90::1",
      "febf::1",
      "fec0::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "0:0:0:0:0:ffff:a9fe:a9fe",
      "64:ff9b::7f00:1",
      "2002:7f00:1::1",
      "::127.0.0.1",
      "fd00:ec2::254",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  test("does not flag public addresses, including public-v4-in-v6", () => {
    for (const address of [
      "8.8.8.8",
      "93.184.216.34",
      "2606:4700:4700::1111",
      "::ffff:8.8.8.8",
      "64:ff9b::808:808",
      "2002:808:808::1",
    ]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });
});
