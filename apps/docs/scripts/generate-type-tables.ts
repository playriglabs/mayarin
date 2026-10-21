/**
 * Fills the type tables on the SDK reference page from the SDK's own source.
 *
 * `src/pages/sdk/typescript/reference.mdx` marks each table with
 *
 *   {/* types: packages/sdk/src/index.ts MayarinConfig *\/}
 *   {/* /types *\/}
 *
 * and this script rewrites what sits between the two markers: one row per
 * property, inherited ones included, with the type and the doc comment.
 *
 * Run `bun run --cwd apps/docs generate:types`. CI runs `types:check`, which
 * fails when the checked-in page is stale.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../../..");
const page = resolve(import.meta.dirname, "../src/pages/sdk/typescript/reference.mdx");
const marker = /\{\/\* types: (\S+) (\w+) \*\/\}\n[\s\S]*?\{\/\* \/types \*\/\}/g;

const programs = new Map<string, ts.Program>();

function program(file: string): ts.Program {
  const cached = programs.get(file);
  if (cached !== undefined) return cached;
  const config = ts.getParsedCommandLineOfConfigFile(
    resolve(root, "packages/sdk/tsconfig.json"),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (config === undefined) throw new Error("packages/sdk/tsconfig.json did not parse");
  const created = ts.createProgram([resolve(root, file)], config.options);
  programs.set(file, created);
  return created;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function table(file: string, name: string): string {
  const compiled = program(file);
  const checker = compiled.getTypeChecker();
  const source = compiled.getSourceFile(resolve(root, file));
  if (source === undefined) throw new Error(`${file} is not in the SDK program`);
  const module = checker.getSymbolAtLocation(source);
  const symbol = module && checker.getExportsOfModule(module).find((s) => s.name === name);
  if (symbol === undefined) throw new Error(`${name} is not exported from ${file}`);
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const rows = checker.getPropertiesOfType(type).map((property) => {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    const typeText =
      declaration === undefined
        ? "unknown"
        : checker.typeToString(
            checker.getTypeOfSymbolAtLocation(property, declaration),
            undefined,
            ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
          );
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
    const doc = ts.displayPartsToString(property.getDocumentationComment(checker));
    return `| \`${property.name}${optional ? "?" : ""}\` | \`${cell(typeText).replace(/`/g, "")}\` | ${cell(doc).replace(/[{}<>]/g, "\\$&")} |`;
  });
  return ["| Property | Type | Description |", "| --- | --- | --- |", ...rows].join("\n");
}

const before = readFileSync(page, "utf8");
const after = before.replace(
  marker,
  (_match, file: string, name: string) =>
    `{/* types: ${file} ${name} */}\n${table(file, name)}\n{/* /types */}`,
);

if (process.argv.includes("--check")) {
  if (before !== after) {
    console.error("reference.mdx is stale; run `bun run --cwd apps/docs generate:types`");
    process.exit(1);
  }
} else {
  writeFileSync(page, after);
}
