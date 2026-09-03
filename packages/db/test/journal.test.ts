/**
 * The migration journal has to agree with the migration directory.
 *
 * Every migration since 0009 is hand-written, and drizzle-kit is not run to
 * produce them — so `meta/_journal.json` is hand-extended too, and forgetting
 * is silent in the worst possible way. A `.sql` file with no journal entry is
 * **skipped**: the migrator prints "Migrations applied", records a row, exits
 * zero, and creates nothing. 0026 shipped that way and was caught only because
 * a test then failed on the missing table.
 *
 * The reverse is worse and quieter: a journal entry naming a file that is not
 * there makes the migrator throw at boot, on a machine that has never run this
 * migration before — which is to say, in production and not in review.
 *
 * These run with no database. They compare two files, which is the whole point:
 * the failure they catch is one a database would only reveal later.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as {
  entries: JournalEntry[];
};

const sqlFiles = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => name.replace(/\.sql$/, ""))
  .sort();

describe("migration journal", () => {
  // The silent one. A file the journal does not name is never executed, and
  // nothing reports that: the migrator says it applied migrations and exits
  // zero.
  test("names every migration file", () => {
    const tagged = new Set(journal.entries.map((entry) => entry.tag));
    const unregistered = sqlFiles.filter((tag) => !tagged.has(tag));

    expect(unregistered).toEqual([]);
  });

  // The loud one, but loud in the wrong place: it throws at boot on a machine
  // that has not run this migration before, which is production rather than
  // review.
  test("names no migration that does not exist", () => {
    const present = new Set(sqlFiles);
    const missing = journal.entries.map((entry) => entry.tag).filter((tag) => !present.has(tag));

    expect(missing).toEqual([]);
  });

  // `idx` is the order they run in. A gap or a repeat means two migrations
  // claim one position, and which of them runs is left to however the journal
  // happened to be sorted.
  test("numbers entries contiguously from zero", () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_entry, index) => index),
    );
  });

  // The filename prefix and the journal index are two statements of the same
  // ordering, and a migration inserted by hand can satisfy one without the
  // other — leaving a directory listing that reads in a different order from
  // the one the migrator uses.
  test("agrees with the order the filenames imply", () => {
    for (const entry of journal.entries) {
      expect(entry.tag.startsWith(String(entry.idx).padStart(4, "0"))).toBe(true);
    }
  });
});
