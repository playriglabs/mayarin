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
 * `metadata.kind` picks the garment geometry, `metadata.tone` its colorway
 * (`src/product-art.tsx`), and `metadata.category` drives the storefront
 * filter — all ride the product's free-form metadata through the API.
 */
const SEED_PRODUCTS = [
  {
    sku: "TEE-BRAGA-BLK",
    name: "Kaos 'Braga'",
    description: "Katun 24s, sablon plastisol satu warna di dada.",
    amount: "129000.00",
    kind: "tee",
    tone: "hitam",
    category: "Atasan",
  },
  {
    sku: "TEE-RIAU-CRM",
    name: "Kaos 'Riau'",
    description: "Katun 24s warna krem, jahitan rantai di bahu.",
    amount: "119000.00",
    kind: "tee",
    tone: "krem",
    category: "Atasan",
  },
  {
    sku: "TEE-TRUNOJOYO-BRK",
    name: "Kaos 'Trunojoyo'",
    description: "Katun 24s warna bata, potongan boxy.",
    amount: "129000.00",
    kind: "tee",
    tone: "bata",
    category: "Atasan",
  },
  {
    sku: "FLNL-CIHAMPELAS-RED",
    name: "Flanel 'Cihampelas'",
    description: "Flanel kotak merah-hitam, brushed cotton.",
    amount: "219000.00",
    kind: "flannel",
    tone: "merah",
    category: "Atasan",
  },
  {
    sku: "FLNL-SETIABUDI-GRN",
    name: "Flanel 'Setiabudi'",
    description: "Flanel kotak hijau tua, dua saku dada.",
    amount: "229000.00",
    kind: "flannel",
    tone: "hijau",
    category: "Atasan",
  },
  {
    sku: "HOOD-LEMBANG-GRN",
    name: "Hoodie 'Lembang'",
    description: "Fleece 320 gsm, tali gepeng, saku kanguru.",
    amount: "299000.00",
    kind: "hoodie",
    tone: "hijau",
    category: "Luaran",
  },
  {
    sku: "HOOD-CIWIDEY-CHR",
    name: "Hoodie 'Ciwidey'",
    description: "Fleece 320 gsm warna arang, rib tebal.",
    amount: "289000.00",
    kind: "hoodie",
    tone: "arang",
    category: "Luaran",
  },
  {
    sku: "JKT-ASIA-AFRIKA-NVY",
    name: "Coach Jacket 'Asia Afrika'",
    description: "Nilon tahan angin, kancing jepret, furing jaring.",
    amount: "349000.00",
    kind: "jacket",
    tone: "navy",
    category: "Luaran",
  },
  {
    sku: "JKT-CIPAGANTI-BLK",
    name: "Coach Jacket 'Cipaganti'",
    description: "Nilon hitam, kerah kemeja, dua saku dalam.",
    amount: "359000.00",
    kind: "jacket",
    tone: "hitam",
    category: "Luaran",
  },
  {
    sku: "CRG-BUAHBATU-OLV",
    name: "Cargo 'Buah Batu'",
    description: "Ripstop olive, enam saku, potongan lurus.",
    amount: "259000.00",
    kind: "cargo",
    tone: "olive",
    category: "Bawahan",
  },
  {
    sku: "CRG-KOPO-CHR",
    name: "Cargo 'Kopo'",
    description: "Ripstop arang, lutut artikulasi, pinggang karet.",
    amount: "249000.00",
    kind: "cargo",
    tone: "arang",
    category: "Bawahan",
  },
  {
    sku: "CAP-DAGO-BRN",
    name: "Topi 'Dago'",
    description: "Corduroy enam panel, bordir mark di depan.",
    amount: "89000.00",
    kind: "cap",
    tone: "cokelat",
    category: "Aksesori",
  },
  {
    sku: "CAP-PUNCLUT-BLK",
    name: "Topi 'Punclut'",
    description: "Twill hitam, strap belakang logam.",
    amount: "95000.00",
    kind: "cap",
    tone: "hitam",
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
    metadata: { kind: product.kind, tone: product.tone, category: product.category },
  });
  console.log(`Created ${product.sku} — ${product.name}`);
}

if (missing.length === 0) {
  console.log(`All ${SEED_PRODUCTS.length} demo products exist already. Nothing to do.`);
} else {
  console.log(`\nSeeded ${missing.length} product(s). Start the demo with \`bun run dev\`.`);
}
