import { describe, expect, test } from "bun:test";
import { decodeFunctionData, keccak256, toHex, zeroAddress } from "viem";
import { ESCROW_FACTORY_ABI, escrowAddress, escrowCalldata, escrowSalt } from "../src/escrow.ts";

// Emitted by EscrowFactory itself (forge script, factory at ESCROW_FACTORY), so
// the TS derivation is checked against the contract, not against a copy of it.
const TERMS = {
  intentId: keccak256(toHex("intent-1")),
  payer: "0x000000000000000000000000000000000000cafE",
  payee: "0x000000000000000000000000000000000000bEEF",
  arbiter: zeroAddress,
  releaseAfter: 1_790_000_000n,
};

describe("escrow", () => {
  test("salt and address match EscrowFactory", () => {
    expect(escrowSalt(TERMS)).toBe(
      "0xa4f5119dab1191915cb8c570e96dadedb88f7bd41a4bb5fd9b91466a785b98ef",
    );
    expect(escrowAddress(TERMS)).toBe("0xD8BDC7Bcb72B9872527D83e4092F0211da924c47");
  });

  test("every term moves the address", () => {
    const base = escrowAddress(TERMS);
    expect(escrowAddress({ ...TERMS, payee: TERMS.payer })).not.toBe(base);
    expect(escrowAddress({ ...TERMS, releaseAfter: TERMS.releaseAfter + 1n })).not.toBe(base);
  });

  test("calldata round-trips through the ABI", () => {
    const token = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
    const release = decodeFunctionData({
      abi: ESCROW_FACTORY_ABI,
      data: escrowCalldata("release", TERMS, token),
    });
    expect(release.functionName).toBe("release");
    expect(release.args[1]).toBe(token);

    const dispute = decodeFunctionData({
      abi: ESCROW_FACTORY_ABI,
      data: escrowCalldata("dispute", TERMS, token),
    });
    expect(dispute.functionName).toBe("dispute");
  });
});
