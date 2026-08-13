/** Local development entry point for the separately deployed chain worker. */

if (process.env.CHAIN_ENABLED === "true") {
  await import("../../api/src/chain-worker.ts");
} else {
  console.log("[chain-worker] disabled (set CHAIN_ENABLED=true to start ingestion)");
  // Keep Turbo's persistent dev task alive. `--watch` restarts this entry when
  // the local configuration or imported worker code changes.
  await new Promise<never>(() => {});
}
