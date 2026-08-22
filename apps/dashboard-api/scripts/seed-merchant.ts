/**
 * `seed:merchant` — backend-only account creation tooling.
 *
 * Creates a merchant tenant + its first account. There is no public waitlist
 * flow; an operator runs this after migrating an empty database to mint the
 * first merchant-admin, who can then grant sub-accounts in the same merchant via
 * `POST /admin/users`.
 *
 * Run it with no flags for an interactive prompt:
 *
 *   bun run seed:merchant
 *     Email: a@b.com
 *     Merchant name: Acme
 *     Password (blank = generate):       <-- enter to auto-generate
 *     Permissions (blank = full admin, comma-sep):  <-- enter for all three
 *
 * Or pass everything for scripting:
 *
 *   bun run seed:merchant -- --email a@b.com --merchant-name "Acme" \
 *     [--password ...] [--permissions payments:read,users:manage,admin:access]
 *
 * A settlement address is configuration, not proof of control. For a
 * disposable development fixture only, pair it with
 * `--trust-settlement-address` to record the seed operator's assertion as a
 * verified linked wallet without a signature challenge.
 *
 * Flags override prompts field-by-field, so `--merchant-name Acme` still prompts
 * for the rest. A strong random password is generated + printed once when no
 * password is given (flag or prompt). `--permissions` defaults to the full
 * merchant-admin set. Exits 0 on success, 1 on a missing required field or a
 * duplicate email.
 */

import { MERCHANT_ADMIN_PERMISSIONS } from "@mayarin/auth";
import { type AssetCode, isAssetCode } from "@mayarin/shared";
import { loadConfig } from "../src/config.ts";
import { createContainer } from "../src/container.ts";
import { parsePermissions } from "../src/dto/auth.ts";
import { trustedSettlementWallet } from "./trusted-settlement-wallet.ts";

interface Args {
  email: string | undefined;
  merchantName: string | undefined;
  password: string | undefined;
  permissions: string | undefined;
  settlementAsset: string | undefined;
  acceptedAssets: string | undefined;
  settlementAddress: string | undefined;
  trustSettlementAddress: boolean;
  city: string | undefined;
  countryCode: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    email: undefined,
    merchantName: undefined,
    password: undefined,
    permissions: undefined,
    settlementAsset: undefined,
    acceptedAssets: undefined,
    settlementAddress: undefined,
    trustSettlementAddress: false,
    city: undefined,
    countryCode: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--email":
        args.email = value;
        i++;
        break;
      case "--merchant-name":
        args.merchantName = value;
        i++;
        break;
      case "--password":
        args.password = value;
        i++;
        break;
      case "--permissions":
        args.permissions = value;
        i++;
        break;
      case "--settlement-asset":
        args.settlementAsset = value;
        i++;
        break;
      case "--accepted-assets":
        args.acceptedAssets = value;
        i++;
        break;
      case "--settlement-address":
        args.settlementAddress = value;
        i++;
        break;
      case "--trust-settlement-address":
        args.trustSettlementAddress = true;
        break;
      case "--city":
        args.city = value;
        i++;
        break;
      case "--country":
        args.countryCode = value;
        i++;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${flag}`);
        console.error(USAGE);
        process.exit(1);
    }
  }
  return args;
}

const USAGE = `Usage: bun run seed:merchant                       # interactive prompts
       bun run seed:merchant -- --email <email> --merchant-name <name> [--password <pw>] [--permissions ...]
                             [--settlement-asset USDC] [--accepted-assets ETH,USDC]
                             [--settlement-address 0x...] [--trust-settlement-address]
                             [--city Jakarta] [--country ID]`;

/**
 * The full merchant-admin set, taken from `@mayarin/auth` rather than restated.
 *
 * A local copy drifted once: it listed three permissions while the permission
 * table had four, so the first account on every seeded merchant could not open
 * the settlement settings that decide where its own money is paid.
 */
const DEFAULT_PERMISSIONS = MERCHANT_ADMIN_PERMISSIONS;

const DEFAULT_SETTLEMENT_ASSET = "USDC";

function parseAsset(value: string): AssetCode {
  if (!isAssetCode(value)) {
    console.error(`Unknown asset: ${value}`);
    process.exit(1);
  }
  return value;
}

if (process.env.DATABASE_URL === undefined) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

/** Returns the trimmed answer, or `undefined` on EOF (Ctrl-D). */
function ask(question: string): string | undefined {
  const answer = prompt(question);
  return answer === null ? undefined : answer.trim();
}

// Required fields: take the flag if given, otherwise prompt. An empty answer for
// a required field aborts.
const email = args.email ?? ask("Email: ");
if (email === undefined || email === "") {
  console.error("Email is required");
  console.error(USAGE);
  process.exit(1);
}

const merchantName = args.merchantName ?? ask("Merchant name: ");
if (merchantName === undefined || merchantName === "") {
  console.error("Merchant name is required");
  console.error(USAGE);
  process.exit(1);
}

// Optional password: blank / omitted → generated. The prompt echoes input (no
// masking); acceptable for an operator-only tool.
const passwordAnswer =
  args.password === undefined ? ask("Password (blank = generate): ") : args.password;
const password = passwordAnswer === undefined || passwordAnswer === "" ? undefined : passwordAnswer;

// Optional permissions: blank / omitted → full merchant-admin set.
const permissionsAnswer =
  args.permissions === undefined
    ? ask("Permissions (blank = full admin, comma-sep): ")
    : args.permissions;
const permissions = parsePermissions(
  permissionsAnswer === undefined || permissionsAnswer === ""
    ? DEFAULT_PERMISSIONS
    : permissionsAnswer.split(",").map((p) => p.trim()),
);

// Settlement asset: what the merchant is paid in. Accepted assets: what a payer
// may pay with. Listing the settlement asset itself is what enables the no-swap
// path, so it is added when the operator leaves it out.
const settlementAnswer =
  args.settlementAsset ?? ask(`Settlement asset (blank = ${DEFAULT_SETTLEMENT_ASSET}): `);
const settlementAsset = parseAsset(
  settlementAnswer === undefined || settlementAnswer === ""
    ? DEFAULT_SETTLEMENT_ASSET
    : settlementAnswer.trim(),
);

const acceptedAnswer =
  args.acceptedAssets ?? ask("Accepted payer assets (blank = settlement asset only, comma-sep): ");
const acceptedAssets =
  acceptedAnswer === undefined || acceptedAnswer === ""
    ? [settlementAsset]
    : acceptedAnswer.split(",").map((asset) => parseAsset(asset.trim()));

// On-chain settlement address. Blank is allowed — a merchant who settles
// off-chain never needs one, and the contract path refuses to lock without it
// rather than paying into some shared default.
const addressAnswer = args.settlementAddress ?? ask("On-chain settlement address (blank = none): ");
const settlementAddress =
  addressAnswer === undefined || addressAnswer === "" ? undefined : addressAnswer.trim();
if (settlementAddress !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(settlementAddress)) {
  console.error(`Not a valid address: ${settlementAddress}`);
  process.exit(1);
}
if (args.trustSettlementAddress && settlementAddress === undefined) {
  console.error("--trust-settlement-address requires --settlement-address 0x…");
  process.exit(1);
}

// Merchant profile. A buyer is shown both, and the payment link surface refuses
// to mint without them — asked here so a freshly seeded merchant can sell
// immediately rather than discovering the gap at the first link.
const cityAnswer = args.city ?? ask("City (blank = set it later in settings): ");
const city = cityAnswer === undefined || cityAnswer === "" ? undefined : cityAnswer.trim();

const countryAnswer = args.countryCode ?? ask("Country code (blank = set it later, e.g. ID): ");
const countryCode =
  countryAnswer === undefined || countryAnswer === ""
    ? undefined
    : countryAnswer.trim().toUpperCase();
if (countryCode !== undefined && !/^[A-Z]{2}$/.test(countryCode)) {
  console.error(`Not a two-letter country code: ${countryCode}`);
  process.exit(1);
}

const config = loadConfig();
if (
  args.trustSettlementAddress &&
  settlementAddress?.toLowerCase() === config.treasuryAddress?.toLowerCase()
) {
  console.error("The settlement address is this deployment's treasury address and cannot be paid");
  process.exit(1);
}
const container = createContainer({ config });

try {
  const result = await container.users.createMerchantAccount({
    email,
    ...(password === undefined ? {} : { password }),
    merchantName,
    settlementAsset,
    acceptedAssets,
    ...(settlementAddress === undefined ? {} : { settlementAddress }),
    ...(city === undefined ? {} : { city }),
    ...(countryCode === undefined ? {} : { countryCode }),
    permissions,
  });

  const trustedAt = new Date();
  const trustedWallet =
    settlementAddress === undefined || !args.trustSettlementAddress
      ? undefined
      : trustedSettlementWallet({
          merchantId: result.user.merchantId,
          chain: config.walletProvisionChain,
          address: settlementAddress,
          trustedAt,
        });
  if (trustedWallet !== undefined) {
    await container.merchantWallets.insert(trustedWallet);
  }

  console.log(`merchantId: ${result.user.merchantId}`);
  console.log(`userId:    ${result.user.id}`);
  console.log(`email:     ${result.user.email}`);
  console.log(`permissions: ${[...result.user.permissions].join(", ")}`);
  if (result.password !== undefined) {
    // Generated password — printed once; the operator stores it and hands it to
    // the merchant. Not re-derivable from the stored hash.
    console.log(`password:  ${result.password}  (generated — store it now)`);
  } else {
    console.log("password:  (used the supplied password)");
  }

  // The payment API requires a bearer key on its merchant routes (#14), and
  // keys are minted on the dashboard — so the seed mints the first one, or the
  // quickstart's first curl answers 401 with no way forward but the browser.
  const minted = await container.apiKeys.create(
    { merchantId: result.user.merchantId, permissions: new Set(permissions) },
    { name: "seed key", permissions },
  );
  console.log(`apiKey:    ${minted.secret}  (printed once — store it now)`);

  // Seeding cannot provision a wallet, and saying so here is the difference
  // between an operator who knows the next step and one who finds out when a
  // payment refuses to lock. Provisioning needs a *verified merchant-held*
  // signer — an address a signature recovered to — and no script can produce
  // that on the merchant's behalf without holding their key, which is the one
  // thing the whole wallet design refuses to do.
  if (trustedWallet !== undefined) {
    console.log("");
    console.log(`Trusted settlement wallet on ${trustedWallet.chain}: ${trustedWallet.address}`);
    console.log("WARNING: the seed operator asserted control; no signature proof was performed.");
    console.log("Use this bypass only for disposable development or test fixtures.");
  } else if (settlementAddress !== undefined) {
    console.log("");
    console.log(
      `Settlement address recorded but not verified on ${config.walletProvisionChain}: ${settlementAddress.toLowerCase()}`,
    );
    console.log("Contract-path payments will be refused until the merchant proves control:");
    console.log("  1. Sign in to the dashboard → Wallets → Connect existing");
    console.log("  2. Link this address and sign its verification challenge");
    console.log(
      "For a disposable fixture, create it with both --settlement-address and --trust-settlement-address.",
    );
  } else {
    console.log("");
    console.log("No settlement address. Nothing can be paid out until there is one:");
    console.log("  1. Sign in to the dashboard → Wallets → Connect existing (or Passkey)");
    console.log("  2. Prove control of it by signing the challenge");
    console.log("  3. Create managed wallet — the Safe becomes the settlement address");
    console.log(
      "Or seed a disposable fixture with --settlement-address 0x… --trust-settlement-address.",
    );
  }
} catch (error) {
  console.error(
    `Failed to create merchant account: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
} finally {
  await container.close();
}
