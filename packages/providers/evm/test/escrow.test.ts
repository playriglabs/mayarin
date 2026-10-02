import { describe, expect, test } from "bun:test";
import { decodeFunctionData, keccak256, toHex, zeroAddress } from "viem";
import {
  ESCROW_FACTORY_ABI,
  ESCROW_FACTORY_V2,
  ESCROW_FACTORY_V2_ABI,
  escrowAddress,
  escrowBondApproveCalldata,
  escrowCalldata,
  escrowFactoryOf,
  escrowResolveCalldata,
  escrowSalt,
} from "../src/escrow.ts";

// Emitted by EscrowFactory itself (forge script, factory at ESCROW_FACTORY), so
// the TS derivation is checked against the contract, not against a copy of it.
const TERMS = {
  intentId: keccak256(toHex("intent-1")),
  payer: "0x000000000000000000000000000000000000cafE",
  payee: "0x000000000000000000000000000000000000bEEF",
  arbiter: zeroAddress,
  releaseAfter: 1_790_000_000n,
  resolveBy: 1_790_604_800n,
};

describe("escrow", () => {
  test("salt and address match EscrowFactory", () => {
    expect(escrowSalt(TERMS)).toBe(
      "0x4c1c5f961e0b5b762a988b064da027b1bf41ed19c8421ee22cc2528ee84a271d",
    );
    expect(escrowAddress(TERMS)).toBe("0x6263F75B7315EE30c9AEe4d924AD62D8c9D42dCd");
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

// Emitted by EscrowFactoryV2 at ESCROW_FACTORY_V2 (forge script), same terms plus a bond.
const TERMS_V2 = { ...TERMS, bond: 5_000_000n };

describe("escrow v2 (#315)", () => {
  test("salt and address match EscrowFactoryV2", () => {
    expect(escrowFactoryOf(TERMS_V2)).toBe(ESCROW_FACTORY_V2);
    expect(escrowSalt(TERMS_V2)).toBe(
      "0x31a7745462d7e8f26c7d9d57e2da3265f01e994e32fe1ad173065632c5f777f8",
    );
    expect(escrowAddress(TERMS_V2)).toBe("0x62EE3F108D48E77E1BCA2Ae18e81342AE713EFd7");
  });

  test("a zero bond is still v2 and still a different address from v1", () => {
    expect(escrowFactoryOf({ ...TERMS, bond: 0n })).toBe(ESCROW_FACTORY_V2);
    expect(escrowAddress({ ...TERMS, bond: 0n })).not.toBe(escrowAddress(TERMS));
  });

  test("dispute and resolve encode the v2 terms", () => {
    const token = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
    const dispute = decodeFunctionData({
      abi: ESCROW_FACTORY_V2_ABI,
      data: escrowCalldata("dispute", TERMS_V2, token),
    });
    expect(dispute.functionName).toBe("dispute");
    expect(dispute.args[1]).toBe(token);

    const resolve = decodeFunctionData({
      abi: ESCROW_FACTORY_V2_ABI,
      data: escrowResolveCalldata(TERMS_V2, token, 7_000),
    });
    expect(resolve.functionName).toBe("resolve");
    expect(resolve.args[2]).toBe(7_000);
    expect(() => escrowResolveCalldata(TERMS, token, 5_000)).toThrow("v1");
    expect(() => escrowResolveCalldata(TERMS_V2, token, 10_001)).toThrow();
  });

  test("the bond approval names the v2 factory and the bond", () => {
    expect(escrowBondApproveCalldata(TERMS_V2).slice(0, 10)).toBe("0x095ea7b3");
  });
});
