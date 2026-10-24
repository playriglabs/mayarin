/**
 * Writes one reference page per OpenAPI tag under `src/pages/api-reference/`.
 *
 * Vocs 2.10 is meant to mount these pages itself from the `openapi` entry in
 * `vocs.config.ts`, but its runtime config drops `openapi`, so nothing is
 * mounted and every tag URL is a 404. Authored pages that embed
 * `<OpenApi.Operation>` render the same operation block, with the playground,
 * and the generated sidebar still points at these paths. Delete this script
 * once Vocs mounts the section itself.
 *
 * Run `bun run --cwd apps/docs generate:api-pages`. CI runs `api-pages:check`.
 */

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

type Operation = { operationId?: string; tags?: string[] };
type Spec = { paths: Record<string, Record<string, Operation>> };

const MOUNT = "/api-reference";
const dir = resolve(import.meta.dirname, "../src/pages/api-reference");
const spec = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../src/lib/openapi.json"), "utf8"),
) as Spec;

const slug = (tag: string): string => tag.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const operationsByTag = new Map<string, string[]>();
for (const item of Object.values(spec.paths)) {
  for (const operation of Object.values(item)) {
    const tag = operation.tags?.[0];
    if (tag === undefined || operation.operationId === undefined) continue;
    operationsByTag.set(tag, [...(operationsByTag.get(tag) ?? []), operation.operationId]);
  }
}

const pages = new Map<string, string>();
for (const [tag, ids] of operationsByTag) {
  pages.set(
    `${slug(tag)}.mdx`,
    `---
title: ${tag}
outline: false
content:
  width: full
---

import { OpenApi } from 'vocs'

# ${tag}

${ids.map((id) => `<OpenApi.Operation spec="${MOUNT}" operationId="${id}" />`).join("\n\n")}
`,
  );
}

const stale = readdirSync(dir).filter((file) => file !== "index.mdx" && !pages.has(file));
const changed =
  stale.length > 0 ||
  [...pages].some(([file, body]) => {
    try {
      return readFileSync(resolve(dir, file), "utf8") !== body;
    } catch {
      return true;
    }
  });

if (process.argv.includes("--check")) {
  if (changed) {
    console.error(
      "api-reference pages are stale; run `bun run --cwd apps/docs generate:api-pages`",
    );
    process.exit(1);
  }
} else {
  for (const file of stale) rmSync(resolve(dir, file));
  for (const [file, body] of pages) writeFileSync(resolve(dir, file), body);
}
