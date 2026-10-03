/**
 * Stages a workspace package for npm: `bun run scripts/stage-npm.ts packages/sdk`.
 *
 * The workspace `package.json` stays `private` and points `exports` at `src`,
 * so the monorepo runs on source with no build step. This writes the published
 * form into `<package>/npm/`: `exports` rewritten onto the built `dist`,
 * `workspace:*` pinned to the dependency's version, and private `@mayarin/*`
 * dependencies dropped — the build bundled them. Publish that directory:
 * `npm publish packages/sdk/npm --tag next`.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** Workspace packages that are published, so a dependency on them stays one. */
const PUBLIC = ["@mayarin/sdk", "@mayarin/react"];

const root = resolve(import.meta.dir, "..");
const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: bun run scripts/stage-npm.ts <package-dir>");

const pkgDir = resolve(root, dir);
const source = readJson(join(pkgDir, "package.json"));
if (!existsSync(join(pkgDir, "dist"))) {
  throw new Error(`${dir}/dist is missing — run the package's build first`);
}

const exportsMap: Record<string, { types: string; import: string }> = {};
for (const [subpath, target] of Object.entries(source.exports as Record<string, string>)) {
  const name = basename(target).replace(/\.tsx?$/, "");
  exportsMap[subpath] = { types: `./dist/${name}.d.ts`, import: `./dist/${name}.js` };
}

const dependencies: Record<string, string> = {};
for (const [name, range] of Object.entries((source.dependencies ?? {}) as Record<string, string>)) {
  if (!name.startsWith("@mayarin/")) dependencies[name] = range;
  else if (PUBLIC.includes(name)) dependencies[name] = `^${workspaceVersion(name)}`;
}

const published = {
  name: source.name,
  version: source.version,
  description: source.description,
  license: "Apache-2.0",
  homepage: "https://docs.mayarin.xyz",
  repository: {
    type: "git",
    url: "git+https://github.com/playriglabs/mayarin.git",
    directory: dir,
  },
  type: "module",
  sideEffects: false,
  engines: { node: ">=20" },
  exports: exportsMap,
  files: ["dist"],
  ...(Object.keys(dependencies).length === 0 ? {} : { dependencies }),
  ...(source.peerDependencies === undefined ? {} : { peerDependencies: source.peerDependencies }),
  publishConfig: { access: "public" },
};

const out = join(pkgDir, "npm");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync(join(pkgDir, "dist"), join(out, "dist"), { recursive: true });
cpSync(join(pkgDir, "README.md"), join(out, "README.md"));
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));
writeFileSync(join(out, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
console.log(`staged ${source.name}@${source.version} in ${dir}/npm`);

function workspaceVersion(name: string): string {
  const folder = name.replace("@mayarin/", "");
  return readJson(join(root, "packages", folder, "package.json")).version as string;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}
