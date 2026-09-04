/**
 * Write the PaymentRouter ABI where `graph codegen` expects it.
 *
 * The ABI has one source in this repository — the Foundry artifact, exported as
 * `@mayarin/contracts` — and a subgraph that carried its own copy would keep
 * indexing an event shape the contract had already changed. So the copy is
 * generated, ignored by git, and rebuilt before every codegen.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { paymentRouterAbi } from "@mayarin/contracts";

const target = path.resolve(import.meta.dirname, "../abis/PaymentRouter.json");

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(paymentRouterAbi, null, 2)}\n`, "utf8");

console.log(`wrote ${path.relative(process.cwd(), target)}`);
