import { describe, expect, test } from "bun:test";
import { isContractCode } from "../src/contract-code.ts";

describe("isContractCode", () => {
  test("an address with no code is an EOA", () => {
    expect(isContractCode(undefined)).toBe(false);
    expect(isContractCode("0x")).toBe(false);
  });

  test("a deployed contract is a contract", () => {
    // A Safe proxy: 0x363d3d37... and so on, far longer than a delegation.
    expect(isContractCode("0x363d3d373d3d3d363d73d9db270c1b5e3bd161e8c8503c55ceabee709552")).toBe(
      true,
    );
  });

  test("an EIP-7702 delegation is still an EOA", () => {
    // 0xef0100 plus the 20-byte delegate: what the Undrly settlement address showed on Base.
    expect(isContractCode("0xef0100000000009b1d0af20d8c6d0a44e162d11f9b8f00")).toBe(false);
    expect(isContractCode("0xEF0100A1B2C3D4E5F60718293A4B5C6D7E8F901234567890".slice(0, 48))).toBe(
      false,
    );
  });

  test("code that merely starts like a delegation but is longer is a contract", () => {
    expect(isContractCode(`0xef0100${"ab".repeat(21)}`)).toBe(true);
  });
});
