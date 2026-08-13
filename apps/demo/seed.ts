/**
 * Demo seed (#137): one merchant, a handful of IDR products, idempotently.
 *
 * The merchant comes from `bun run seed:merchant` — the repo's one account
 * creation tool — spawned non-interactively when `apps/demo/.env` names no
 * merchant yet. Its output (merchant id, secret key) is written back into
 * `.env`, so the first run is self-contained. Products are then upserted by
 * SKU through the server SDK, so repeated runs change nothing.
 */

import { resolve } from "node:path";
import { createMayarin } from "@mayarin/sdk";
import { DEMO_CURRENCY } from "./server/index.ts";

const ENV_PATH = resolve(import.meta.dir, ".env");
const REPO_ROOT = resolve(import.meta.dir, "../..");

/**
 * The catalog of a Bandung distro: garments named after the city's streets.
 * `metadata.kind` picks the illustration in `src/product-art.tsx` and
 * `metadata.category` drives the storefront filter — both ride the product's
 * free-form metadata through the API untouched.
 */
const SEED_PRODUCTS = [
  {
    sku: "TEE-BRAGA",
    name: "Kaos 'Braga'",
    description: "Kaos katun 24s, sablon plastisol. Hitam, unisex.",
    amount: "129000.00",
    kind: "tee",
    category: "Atasan",
  },
  {
    sku: "FLNL-CIHAMPELAS",
    name: "Flanel 'Cihampelas'",
    description: "Kemeja flanel kotak-kotak, brushed cotton.",
    amount: "219000.00",
    kind: "flannel",
    category: "Atasan",
  },
  {
    sku: "HOOD-LEMBANG",
    name: "Hoodie 'Lembang'",
    description: "Fleece 320 gsm untuk dingin-dinginnya dataran tinggi.",
    amount: "299000.00",
    kind: "hoodie",
    category: "Luaran",
  },
  {
    sku: "JKT-ASIA-AFRIKA",
    name: "Coach Jacket 'Asia Afrika'",
    description: "Jaket coach nilon, kancing jepret, tahan angin.",
    amount: "349000.00",
    kind: "jacket",
    category: "Luaran",
  },
  {
    sku: "CRG-BUAHBATU",
    name: "Cargo 'Buah Batu'",
    description: "Celana cargo ripstop, potongan lurus.",
    amount: "259000.00",
    kind: "cargo",
    category: "Bawahan",
  },
  {
    sku: "CAP-DAGO",
    name: "Topi 'Dago'",
    description: "Topi corduroy enam panel, bordir logo.",
    amount: "89000.00",
    kind: "cap",
    category: "Aksesori",
  },
] as const;

async function readEnvFile(path: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  const file = Bun.file(path);
  if (!(await file.exists())) return entries;
  for (const line of (await file.text()).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    entries.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return entries;
}

function writeEnvFile(path: string, entries: Map<string, string>): Promise<number> {
  const lines = [...entries.entries()].map(([key, value]) => `${key}=${value}`);
  return Bun.write(path, `${lines.join("\n")}\n`);
}

/**
 * Spawns `bun run seed:merchant` with every required flag, stdin closed so the
 * optional prompts fall back to their defaults, and reads the minted merchant
 * id and secret key from its output.
 */
function createMerchant(name: string, city: string, countryCode: string) {
  console.log("No merchant in .env — creating one via `bun run seed:merchant`.\n");
  const spawned = Bun.spawnSync(
    [
      "bun",
      "run",
      "seed:merchant",
      "--",
      "--email",
      "demo@mayarin.local",
      "--merchant-name",
      name,
      "--city",
      city,
      "--country",
      countryCode,
    ],
    { cwd: REPO_ROOT, stdin: "ignore", stdout: "pipe", stderr: "inherit" },
  );
  const output = spawned.stdout.toString();
  // Echoed so the operator sees the generated password, printed only once.
  console.log(output);
  if (spawned.exitCode !== 0) {
    console.error("seed:merchant failed. Fix the cause above and rerun `bun run seed`.");
    console.error("A merchant that already exists can be reused: put its id and an sk_ key");
    console.error("from the dashboard into apps/demo/.env instead.");
    process.exit(1);
  }
  // Not line-anchored: with stdin closed, the prompts and the answers land on
  // one stdout line, so `merchantId:` appears mid-line.
  const merchantId = /merchantId:\s*(\S+)/.exec(output)?.[1];
  const secretKey = /apiKey:\s*(\S+)/.exec(output)?.[1];
  if (merchantId === undefined || secretKey === undefined) {
    console.error("Could not read merchantId and apiKey from the seed:merchant output.");
    process.exit(1);
  }
  return { merchantId, secretKey };
}

const env = await readEnvFile(ENV_PATH);
const get = (key: string): string | undefined => process.env[key] ?? env.get(key);

const merchantName = get("MAYARIN_MERCHANT_NAME") ?? "Parahyangan Supply";
const merchantCity = get("MAYARIN_MERCHANT_CITY") ?? "Bandung";
const merchantCountry = get("MAYARIN_MERCHANT_COUNTRY") ?? "ID";
const apiUrl = get("MAYARIN_API_URL") ?? "http://localhost:3000";

let merchantId = get("MAYARIN_MERCHANT_ID");
let secretKey = get("MAYARIN_SECRET_KEY");

if (merchantId === undefined || secretKey === undefined) {
  const created = createMerchant(merchantName, merchantCity, merchantCountry);
  merchantId = created.merchantId;
  secretKey = created.secretKey;
  env.set("MAYARIN_API_URL", apiUrl);
  env.set("MAYARIN_MERCHANT_ID", merchantId);
  env.set("MAYARIN_SECRET_KEY", secretKey);
  env.set("MAYARIN_MERCHANT_NAME", merchantName);
  env.set("MAYARIN_MERCHANT_CITY", merchantCity);
  env.set("MAYARIN_MERCHANT_COUNTRY", merchantCountry);
  await writeEnvFile(ENV_PATH, env);
  console.log(`Wrote merchant id and secret key to ${ENV_PATH}\n`);
}

const mayarin = createMayarin({ baseUrl: apiUrl, secretKey });

const existing = await mayarin.commerce.products.list(merchantId);
const existingSkus = new Set(existing.map((product) => product.sku));
const missing = SEED_PRODUCTS.filter((product) => !existingSkus.has(product.sku));

for (const product of missing) {
  await mayarin.commerce.products.create({
    merchantId,
    sku: product.sku,
    name: product.name,
    description: product.description,
    prices: [{ amount: product.amount, asset: DEMO_CURRENCY }],
    metadata: { kind: product.kind, category: product.category },
  });
  console.log(`Created ${product.sku} — ${product.name}`);
}

if (missing.length === 0) {
  console.log(`All ${SEED_PRODUCTS.length} demo products exist already. Nothing to do.`);
} else {
  console.log(`\nSeeded ${missing.length} product(s). Start the demo with \`bun run dev\`.`);
}
