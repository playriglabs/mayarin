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
 * Flags override prompts field-by-field, so `--merchant-name Acme` still prompts
 * for the rest. A strong random password is generated + printed once when no
 * password is given (flag or prompt). `--permissions` defaults to the full
 * merchant-admin set. Exits 0 on success, 1 on a missing required field or a
 * duplicate email.
 */

import { loadConfig } from "../src/config.ts";
import { createContainer } from "../src/container.ts";
import { parsePermissions } from "../src/dto/auth.ts";

interface Args {
  email: string | undefined;
  merchantName: string | undefined;
  password: string | undefined;
  permissions: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    email: undefined,
    merchantName: undefined,
    password: undefined,
    permissions: undefined,
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
       bun run seed:merchant -- --email <email> --merchant-name <name> [--password <pw>] [--permissions ...]`;

const DEFAULT_PERMISSIONS = ["payments:read", "users:manage", "admin:access"] as const;

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

const config = loadConfig();
const container = createContainer({ config });

try {
  const result = await container.users.createMerchantAccount({
    email,
    ...(password === undefined ? {} : { password }),
    merchantName,
    permissions,
  });
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
} catch (error) {
  console.error(
    `Failed to create merchant account: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
} finally {
  await container.close();
}
