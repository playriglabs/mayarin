/**
 * The operator's signing account (SEC-06).
 *
 * One place decides where the operator key lives, so the treasury executor, the
 * x402 settlement paths and the nonce reconciler cannot disagree. `local` is the
 * raw key in this process (refused by config on mainnet); `turnkey` keeps it in
 * Turnkey's enclave under the policies in `@mayarin/provider-turnkey`; `aws-kms` keeps
 * it in an AWS KMS key, bounded by IAM and CloudTrail instead of a signing policy.
 */

import { createAwsKmsAccount } from "@mayarin/provider-evm";
import { ApiKeyStamper, createTurnkeyAccount } from "@mayarin/provider-turnkey";
import type { LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.ts";

export function operatorAccount(config: Config): LocalAccount | undefined {
  if (config.operatorSigner === "aws-kms") {
    return createAwsKmsAccount({
      keyId: config.operatorAwsKmsKeyId ?? "",
      signerAddress: (config.operatorAddress ?? "0x") as `0x${string}`,
      ...(config.awsKmsRegion === undefined ? {} : { region: config.awsKmsRegion }),
    });
  }
  if (config.operatorSigner === "turnkey") {
    return createTurnkeyAccount({
      organizationId: config.turnkeyOrganizationId ?? "",
      signWith: config.operatorTurnkeySignWith ?? "",
      signerAddress: (config.operatorAddress ?? "0x") as `0x${string}`,
      stamper: new ApiKeyStamper({
        apiPublicKey: config.operatorTurnkeyApiPublicKey ?? "",
        apiPrivateKey: config.operatorTurnkeyApiPrivateKey ?? "",
      }),
    });
  }
  if (config.operatorPrivateKey === undefined) return undefined;
  return privateKeyToAccount(config.operatorPrivateKey as `0x${string}`);
}
