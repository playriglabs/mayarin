/**
 * The Ethereum addresses of the two AWS KMS keys, read from KMS and written to a file.
 *
 *   bun --env-file=.env.mainnet run scripts/aws-kms-addresses.ts              # read, record
 *   bun --env-file=.env.mainnet run scripts/aws-kms-addresses.ts --sync-env   # + fill .env.mainnet
 *   bun --env-file=.env.mainnet run scripts/aws-kms-addresses.ts --selftest   # + sign once with each key
 *
 * Two keys, never one: the order signer (`AWS_KMS_KEY_ID`) signs every PaymentRouter
 * order, the operator (`OPERATOR_AWS_KMS_KEY_ID`) signs the transactions that sweep
 * deposits and call the router. They hold different powers and must not share a
 * compromise. Each is created as `ECC_SECG_P256K1` / `SIGN_VERIFY`:
 *
 *   aws kms create-key --key-spec ECC_SECG_P256K1 --key-usage SIGN_VERIFY \
 *     --description "mayarin order signer" --region <region>
 *   aws kms create-alias --alias-name alias/mayarin-order-signer --target-key-id <KeyId> --region <region>
 *
 * The address of a key is read from its public key (`GetPublicKey`), so it is never typed.
 * Written to mainnet-addresses.json under `kms`; nothing is printed but the path.
 * `--sync-env` fills a blank SIGNER, AWS_KMS_SIGNER_ADDRESS, DESTINATION and
 * OPERATOR_ADDRESS; it never overwrites one that is set. `--selftest` signs one digest with
 * each key and checks it recovers to that key's address: it proves that this identity may
 * call `kms:Sign`, which a key that merely exists does not. AWS credentials come from the
 * environment the SDK reads (AWS_PROFILE, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY).
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { GetPublicKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { signDigestWithKms } from "@mayarin/provider-evm";
import { getAddress, type Hex, keccak256, recoverAddress } from "viem";

const ROOT = new URL("..", import.meta.url).pathname;
const ENV_FILE = process.env.DEPLOY_ENV_FILE ?? `${ROOT}.env.mainnet`;
const OUT = process.env.MAINNET_ADDRESSES_FILE ?? `${ROOT}mainnet-addresses.json`;
const sync = process.argv.includes("--sync-env");
const selftest = process.argv.includes("--selftest");

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is blank in ${ENV_FILE}`);
  return value;
}

const region = need("AWS_KMS_REGION");
const keys = {
  orderSigner: need("AWS_KMS_KEY_ID"),
  operator: need("OPERATOR_AWS_KMS_KEY_ID"),
};
if (keys.orderSigner === keys.operator) {
  throw new Error("AWS_KMS_KEY_ID and OPERATOR_AWS_KMS_KEY_ID are the same key: they must differ");
}

const client = new KMSClient({ region });

/** An uncompressed secp256k1 point is the last 65 bytes of the DER public key. */
async function addressOf(keyId: string): Promise<Hex> {
  const key = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (key.KeySpec !== "ECC_SECG_P256K1") {
    throw new Error(`${label(keyId)} is ${key.KeySpec}, not ECC_SECG_P256K1`);
  }
  if (key.KeyUsage !== "SIGN_VERIFY")
    throw new Error(`${label(keyId)} is for ${key.KeyUsage}, not SIGN_VERIFY`);
  if (!key.SigningAlgorithms?.includes("ECDSA_SHA_256")) {
    throw new Error(`${label(keyId)} does not offer ECDSA_SHA_256`);
  }
  const der = key.PublicKey;
  if (der === undefined || der.length < 65)
    throw new Error(`${label(keyId)} returned no public key`);
  const point = der.slice(der.length - 65);
  if (point[0] !== 0x04) throw new Error(`${label(keyId)} public key is not an uncompressed point`);
  const hash = keccak256(`0x${Buffer.from(point.slice(1)).toString("hex")}`);
  return getAddress(`0x${hash.slice(-40)}`);
}

// Never the key id itself in a message: an alias is fine, an ARN carries an account number.
const label = (keyId: string) =>
  keyId === keys.operator ? "the operator key" : "the order-signer key";

const addresses = {
  orderSigner: await addressOf(keys.orderSigner),
  operator: await addressOf(keys.operator),
};
if (addresses.orderSigner === addresses.operator) throw new Error("the two keys have one address");

const recorded = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown>)
  : {};
const deployer = (recorded.deployer as { address?: string } | undefined)?.address?.toLowerCase();
if (deployer !== undefined && Object.values(addresses).some((a) => a.toLowerCase() === deployer)) {
  throw new Error("a KMS key has the deployer's address");
}

const verified: Record<string, boolean> = {};
if (selftest) {
  for (const [role, keyId] of Object.entries(keys) as [keyof typeof keys, string][]) {
    const digest = keccak256(`0x${Buffer.from(`mayarin selftest ${role}`).toString("hex")}`);
    const signature = await signDigestWithKms({
      client,
      keyId,
      digest,
      signerAddress: addresses[role],
    });
    verified[role] =
      (await recoverAddress({ hash: digest, signature: signature.hex })) === addresses[role];
  }
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      ...recorded,
      kms: {
        region,
        orderSigner: {
          alias: keys.orderSigner,
          address: addresses.orderSigner,
          signed: verified.orderSigner ?? null,
        },
        operator: {
          alias: keys.operator,
          address: addresses.operator,
          signed: verified.operator ?? null,
        },
      },
    },
    null,
    2,
  )}\n`,
);
chmodSync(OUT, 0o600);

const filled: string[] = [];
if (sync) {
  let text = readFileSync(ENV_FILE, "utf8");
  const fill = (name: string, value: string) => {
    const line = new RegExp(`^(${name}=)[ \\t]*([^#\\n]*)(.*)$`, "m");
    const match = line.exec(text);
    if (match === null || (match[2] ?? "").trim() !== "") return;
    text = text.replace(line, `$1${value}${(match[3] ?? "") === "" ? "" : "   $3"}`);
    filled.push(name);
  };
  fill("SIGNER", addresses.orderSigner);
  fill("AWS_KMS_SIGNER_ADDRESS", addresses.orderSigner);
  fill("DESTINATION", addresses.operator);
  fill("OPERATOR_ADDRESS", addresses.operator);
  writeFileSync(ENV_FILE, text);
  chmodSync(ENV_FILE, 0o600);
}

console.log(
  `wrote ${OUT} (kms: ${Object.keys(addresses).length} keys, mode 600). No address printed.`,
);
if (selftest) {
  const ok = Object.values(verified).every(Boolean);
  console.log(`selftest: ${ok ? "both keys signed and recovered to their own address" : "FAILED"}`);
  if (!ok) process.exit(1);
}
if (sync)
  console.log(
    `${ENV_FILE}: ${filled.length > 0 ? `filled ${filled.join(" ")}` : "nothing to fill (set already)"}.`,
  );
