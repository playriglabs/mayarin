/**
 * The Turnkey policies that bound the operator key (SEC-06).
 *
 * A signing key is only as safe as what its policy lets it sign. Turnkey's
 * policy engine does not apply to root users, and denies a non-root user
 * everything not explicitly allowed, so these three are written for a dedicated
 * non-root signer user:
 *
 * 1. ALLOW transactions to the contracts this deployment uses, on the chains it
 *    uses, up to a value cap. `eth.tx` is readable only for `sign_transaction`.
 * 2. ALLOW typed data that is a Permit2 permit for Permit2 itself on those
 *    chains. `eth.eip_712` is readable only when the payload is sent as EIP-712
 *    (see `account.ts`).
 * 3. DENY every other raw payload. A key that may sign an arbitrary digest may
 *    sign any transaction hash, which would bypass the first policy entirely.
 *
 * Turnkey's engine does not short-circuit, so each policy is scoped by
 * `activity.kind` and reads only the namespace of the activity it names. Every
 * address is written in lowercase, the form Turnkey and the serialized typed
 * data use.
 *
 * Not expressible here: which function a transaction calls (needs a Smart
 * Contract Interface uploaded for each target, then `eth.tx.function_signature`),
 * and the `spender` inside a permit (the message is JSON in `eth.eip_712`).
 */

import { ConfigurationError } from "@mayarin/shared";

export interface TurnkeyPolicy {
  readonly policyName: string;
  readonly effect: "EFFECT_ALLOW" | "EFFECT_DENY";
  readonly consensus: string;
  readonly condition: string;
  readonly notes: string;
}

export interface OperatorPolicyInput {
  /** The non-root Turnkey user (a UUID) the operator's API key belongs to. */
  readonly userId: string;
  /** EIP-155 chain id to the contracts the operator may send transactions to. */
  readonly contracts: Readonly<Record<number, readonly string[]>>;
  /** Largest `value`, in wei, one transaction may carry; 0 when nothing sends native currency. */
  readonly maxValueWei: bigint;
  /** The Permit2 contract the operator signs permits for. */
  readonly permit2: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Turnkey's `int` is 128 bits signed; a condition cannot hold more. */
const MAX_INT = 2n ** 127n - 1n;

function address(value: string, what: string): string {
  if (!ADDRESS.test(value)) {
    throw new ConfigurationError(`${what} is not an address`, { value });
  }
  return value.toLowerCase();
}

export function operatorPolicies(input: OperatorPolicyInput): readonly TurnkeyPolicy[] {
  if (!UUID.test(input.userId)) {
    throw new ConfigurationError("The operator's Turnkey user id must be a UUID", {
      userId: input.userId,
    });
  }
  if (input.maxValueWei < 0n || input.maxValueWei > MAX_INT) {
    throw new ConfigurationError("The value cap must fit a Turnkey int (128 bits)", {
      maxValueWei: input.maxValueWei.toString(),
    });
  }
  const chains = Object.entries(input.contracts).map(([id, targets]) => {
    const chainId = Number(id);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new ConfigurationError("A chain id must be a positive integer", { id });
    }
    if (targets.length === 0) {
      throw new ConfigurationError("A chain with no contracts should be left out", { chainId });
    }
    return { chainId, targets: [...new Set(targets.map((t) => address(t, "A contract")))].sort() };
  });
  if (chains.length === 0) {
    throw new ConfigurationError("The operator needs at least one chain", {});
  }
  chains.sort((a, b) => a.chainId - b.chainId);
  const permit2 = address(input.permit2, "Permit2");

  const consensus = `approvers.any(user, user.id == '${input.userId}')`;
  const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
  const perChain = chains
    .map(
      ({ chainId, targets }) =>
        `(eth.tx.chain_id == ${chainId} && eth.tx.to in [${quoted(targets)}])`,
    )
    .join(" || ");

  return [
    {
      policyName: "operator: transactions to this deployment's contracts",
      effect: "EFFECT_ALLOW",
      consensus,
      condition:
        "activity.kind == 'SIGN_TRANSACTION' && " +
        "activity.params.type == 'TRANSACTION_TYPE_ETHEREUM' && " +
        `(${perChain}) && eth.tx.value <= ${input.maxValueWei}`,
      notes: "Chain, target and value are checked by Turnkey on the parsed transaction.",
    },
    {
      policyName: "operator: Permit2 permits only",
      effect: "EFFECT_ALLOW",
      consensus,
      condition:
        "activity.kind == 'SIGN_RAW_PAYLOAD' && " +
        "activity.params.encoding == 'PAYLOAD_ENCODING_EIP712' && " +
        "eth.eip_712.primary_type == 'PermitSingle' && " +
        `eth.eip_712.domain.verifying_contract == '${permit2}' && ` +
        `eth.eip_712.domain.chain_id in [${chains.map((c) => c.chainId).join(", ")}]`,
      notes: "The only typed data the operator signs.",
    },
    {
      policyName: "operator: no raw digests",
      effect: "EFFECT_DENY",
      consensus,
      condition:
        "activity.kind == 'SIGN_RAW_PAYLOAD' && activity.params.encoding != 'PAYLOAD_ENCODING_EIP712'",
      notes: "A signature over any digest is a signature over any transaction; this closes that.",
    },
    {
      policyName: "operator: no batched raw payloads",
      effect: "EFFECT_DENY",
      consensus,
      condition: "activity.kind == 'SIGN_RAW_PAYLOADS'",
      notes: "The batch form of the above.",
    },
  ];
}
