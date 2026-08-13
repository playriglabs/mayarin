/**
 * Refuses a built bundle that carries the secret (#137 acceptance criterion).
 *
 * Vite inlines only `VITE_`-prefixed variables, so this must never fire — the
 * check exists so a future refactor that moves the secret into client code
 * fails the build instead of shipping the key.
 */

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const DIST = resolve(import.meta.dir, "dist");
const secretValue = process.env.MAYARIN_SECRET_KEY;

const files = await readdir(DIST, { recursive: true });
const leaks: string[] = [];

for (const name of files) {
  const path = resolve(DIST, name);
  const file = Bun.file(path);
  if ((await file.exists()) === false || name.endsWith("/")) continue;
  const text = await file.text().catch(() => "");
  if (text.includes("MAYARIN_SECRET_KEY")) {
    leaks.push(`${name} references MAYARIN_SECRET_KEY`);
  }
  if (secretValue !== undefined && secretValue !== "" && text.includes(secretValue)) {
    leaks.push(`${name} contains the secret key value`);
  }
}

if (leaks.length > 0) {
  console.error("The built bundle is not safe to serve:");
  for (const leak of leaks) console.error(`  - ${leak}`);
  process.exit(1);
}

console.log(`Checked ${files.length} file(s) in dist — no secret in the bundle.`);
