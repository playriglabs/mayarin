/**
 * Postgres adapter for the admin audit trail (0054, SEC-14).
 *
 * Insert only. There is deliberately no update, delete or read-back here: the
 * trail is queried with SQL by whoever is investigating, not by the API.
 */

import type { Executor } from "../client.ts";
import { adminAuditEvents } from "../schema.ts";

export interface AdminAuditEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly method: string;
  readonly path: string;
  readonly outcome: "allowed" | "denied";
  readonly sourceIp: string | null;
  readonly tokenFingerprint: string | null;
}

export interface AdminAuditRepository {
  record(event: AdminAuditEvent): Promise<void>;
}

export class DrizzleAdminAuditRepository implements AdminAuditRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async record(event: AdminAuditEvent): Promise<void> {
    await this.#db.insert(adminAuditEvents).values(event);
  }
}
