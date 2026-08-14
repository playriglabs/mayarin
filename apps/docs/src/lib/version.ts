import { execSync } from "node:child_process";

// Resolved once at module load (SSR keeps the module instance, so this does
// not shell out per request). Falls back to "unknown" outside a git checkout.
let hash = "unknown";
try {
  hash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
} catch {
  hash = "unknown";
}

export const commitHash: string = hash;
