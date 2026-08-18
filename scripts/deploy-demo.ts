/**
 * Deploy the storefront demo to Cloudflare Pages.
 *
 * Usage:
 *   bun run deploy:demo
 *   bun run deploy:demo --skip-gate
 */

interface Flags {
  readonly skipGate: boolean;
}

const parseFlags = (argv: readonly string[]): Flags => {
  const unknownFlag = argv.find((flag) => flag !== "--skip-gate");
  if (unknownFlag !== undefined) {
    throw new Error(`Unknown flag "${unknownFlag}". Use --skip-gate to skip local checks.`);
  }

  return { skipGate: argv.includes("--skip-gate") };
};

const run = async (label: string, command: readonly string[]): Promise<void> => {
  console.log(`\n▶ ${label}`);
  const child = Bun.spawn([...command], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed (exit ${exitCode}). Deployment stopped.`);
  }
};

const flags = parseFlags(process.argv.slice(2));

console.log("Deploying @mayarin/demo to the mayarin-demo Cloudflare Pages project.");

if (flags.skipGate) {
  console.log("\n▶ Local gate skipped (--skip-gate)");
} else {
  await run("Run the local verification suite", ["bun", "run", "check"]);
}

await run("Build and deploy the demo", ["bun", "run", "--cwd", "apps/demo", "deploy"]);

console.log("\nDemo deployment complete.");
