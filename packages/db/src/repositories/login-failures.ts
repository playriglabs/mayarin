/** Postgres store for failed sign-in passwords (SEC-08), shared by every replica. */

import { createHash } from "node:crypto";
import { delayAfter, type LoginFailures } from "@mayarin/auth";
import { eq, lt, sql } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { loginFailures } from "../schema.ts";

const RETENTION_MS = 24 * 60 * 60_000;

export class DrizzleLoginFailures implements LoginFailures {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async waitMs(key: string, now: Date): Promise<number> {
    const [row] = await this.#db
      .select({ blockedUntil: loginFailures.blockedUntil })
      .from(loginFailures)
      .where(eq(loginFailures.key, digest(key)))
      .limit(1);
    return row === undefined ? 0 : Math.max(0, row.blockedUntil.getTime() - now.getTime());
  }

  async record(key: string, now: Date): Promise<void> {
    const id = digest(key);
    // The count is incremented by the database, so two replicas failing the
    // same email at once both count; the wait is then set from the result.
    const [row] = await this.#db
      .insert(loginFailures)
      .values({ key: id, count: 1, blockedUntil: now, updatedAt: now })
      .onConflictDoUpdate({
        target: loginFailures.key,
        set: { count: sql`${loginFailures.count} + 1`, updatedAt: now },
      })
      .returning({ count: loginFailures.count });
    const count = row?.count ?? 1;
    await this.#db
      .update(loginFailures)
      .set({ blockedUntil: new Date(now.getTime() + delayAfter(count)) })
      .where(eq(loginFailures.key, id));
    // A first failure is the moment a new row appeared; old ones go with it.
    if (count === 1) {
      await this.#db
        .delete(loginFailures)
        .where(lt(loginFailures.updatedAt, new Date(now.getTime() - RETENTION_MS)));
    }
  }

  async clear(key: string): Promise<void> {
    await this.#db.delete(loginFailures).where(eq(loginFailures.key, digest(key)));
  }
}

/** Not the address itself: a made-up email should leave nothing readable. */
function digest(key: string): string {
  return createHash("sha256").update(`login-failures:${key}`).digest("hex");
}
