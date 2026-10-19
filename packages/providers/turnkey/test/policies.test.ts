import { describe, expect, test } from "bun:test";
import { operatorPolicies } from "../src/policies.ts";

const USER = "123e4567-e89b-42d3-a456-426614174000";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ROUTER = "0x00000000000000000000000000000000000000AA";
const TOKEN = "0x00000000000000000000000000000000000000bb";

const input = {
  userId: USER,
  contracts: { 8453: [ROUTER, TOKEN], 42161: [TOKEN] },
  maxValueWei: 0n,
  permit2: PERMIT2,
};

describe("operatorPolicies", () => {
  const [transactions, permit, noRaw, noBatch] = operatorPolicies(input);

  test("transactions: only these chains and contracts, up to the value cap, for this user", () => {
    expect(transactions?.effect).toBe("EFFECT_ALLOW");
    expect(transactions?.consensus).toBe(`approvers.any(user, user.id == '${USER}')`);
    expect(transactions?.condition).toBe(
      "activity.kind == 'SIGN_TRANSACTION' && " +
        "activity.params.type == 'TRANSACTION_TYPE_ETHEREUM' && " +
        "((eth.tx.chain_id == 8453 && eth.tx.to in ['0x00000000000000000000000000000000000000aa', '0x00000000000000000000000000000000000000bb']) || " +
        "(eth.tx.chain_id == 42161 && eth.tx.to in ['0x00000000000000000000000000000000000000bb'])) && " +
        "eth.tx.value <= 0",
    );
  });

  test("a contract on one chain is not allowed on another", () => {
    // 0xaa appears only in the chain 8453 clause.
    expect(transactions?.condition.match(/00000000000000000000000000000000000000aa/g)).toHaveLength(
      1,
    );
  });

  test("typed data: a Permit2 permit for Permit2 itself, on these chains, in the readable mode", () => {
    expect(permit?.effect).toBe("EFFECT_ALLOW");
    expect(permit?.condition).toBe(
      "activity.kind == 'SIGN_RAW_PAYLOAD' && " +
        "activity.params.encoding == 'PAYLOAD_ENCODING_EIP712' && " +
        "eth.eip_712.primary_type == 'PermitSingle' && " +
        "eth.eip_712.domain.verifying_contract == '0x000000000022d473030f116ddee9f6b43ac78ba3' && " +
        "eth.eip_712.domain.chain_id in [8453, 42161]",
    );
  });

  test("any other raw payload is denied, which is what stops a digest bypassing the rest", () => {
    expect(noRaw?.effect).toBe("EFFECT_DENY");
    expect(noRaw?.condition).toContain("activity.params.encoding != 'PAYLOAD_ENCODING_EIP712'");
    expect(noBatch?.condition).toBe("activity.kind == 'SIGN_RAW_PAYLOADS'");
  });

  test("each policy is scoped to one activity kind and reads only its own namespace", () => {
    expect(transactions?.condition).not.toContain("eth.eip_712");
    expect(permit?.condition).not.toContain("eth.tx");
    expect(noRaw?.condition).not.toContain("eth.");
  });

  test("addresses are lowercase, and the order of chains and contracts does not matter", () => {
    const shuffled = operatorPolicies({
      ...input,
      contracts: { 42161: [TOKEN], 8453: [TOKEN, ROUTER] },
    });
    expect(shuffled[0]?.condition).toBe(transactions?.condition);
    expect(transactions?.condition).not.toMatch(/0x[0-9a-f]*[A-F]/);
  });

  test("refuses input that could not be a safe policy", () => {
    expect(() => operatorPolicies({ ...input, userId: "root" })).toThrow("UUID");
    expect(() => operatorPolicies({ ...input, permit2: "0x1" })).toThrow("address");
    expect(() => operatorPolicies({ ...input, contracts: { 1: ["'; DROP"] } })).toThrow("address");
    expect(() => operatorPolicies({ ...input, contracts: {} })).toThrow("at least one chain");
    expect(() => operatorPolicies({ ...input, contracts: { 1: [] } })).toThrow("no contracts");
    expect(() => operatorPolicies({ ...input, contracts: { 0: [ROUTER] } })).toThrow("positive");
    expect(() => operatorPolicies({ ...input, maxValueWei: 2n ** 127n })).toThrow("128 bits");
    expect(() => operatorPolicies({ ...input, maxValueWei: -1n })).toThrow("128 bits");
  });
});
