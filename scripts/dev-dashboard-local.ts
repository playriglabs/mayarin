/**
 * Rebuild the local developer database, seed its first merchant, then run the
 * merchant-to-checkout development surface.
 *
 * The destructive step is delegated to `setup --reset-db`, whose target is the
 * checked-in local Docker Compose volume. It never reads Railway credentials.
 */

const ROOT = new URL("..", import.meta.url).pathname;

const run = async (command: readonly string[]): Promise<void> => {
  const child = Bun.spawn(command, {
    cwd: ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
};

await run(["bun", "run", "setup", "--", "--reset-db", "--seed"]);
await run([
  "bunx",
  "turbo",
  "dev",
  "--filter=@mayarin/api",
  "--filter=@mayarin/dashboard-api",
  "--filter=@mayarin/dashboard",
]);
