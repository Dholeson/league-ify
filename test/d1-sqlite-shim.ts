// A D1Database implemented over node:sqlite.
//
// This is a shim, not a mock. It runs the real migration SQL and executes real
// statements against a real SQL engine, so the CHECK constraints, the
// ON CONFLICT upserts, and the composite primary key on matches are all
// genuinely exercised. D1 is SQLite underneath, so the semantics the adapter
// depends on are the same ones being tested here.
//
// What it does NOT reproduce: D1's network behaviour, its value-size ceiling,
// or its batch atomicity guarantees. Those need the real thing —
//   npx wrangler d1 execute dhole-workshop --local --file=migrations/0001_league_ify.sql

import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "../server/storage/d1Store.ts";

export interface ShimDatabase extends D1Database {
  /** Statements executed since the last reset. Lets tests assert on writes. */
  log: string[];
  resetLog(): void;
  raw: DatabaseSync;
  close(): void;
}

export function createSqliteD1(schemaSql: string): ShimDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);

  const log: string[] = [];

  function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
    return {
      bind(...vals: unknown[]) {
        return statement(sql, vals);
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        log.push(sql);
        const rows = db.prepare(sql).all(...(values as never[])) as T[];
        // node:sqlite returns null-prototype objects; normalise so deepEqual
        // and spread behave the way callers expect.
        return { results: rows.map(r => ({ ...(r as object) })) as T[] };
      },
      async first<T = unknown>(): Promise<T | null> {
        log.push(sql);
        const row = db.prepare(sql).get(...(values as never[]));
        return row == null ? null : ({ ...(row as object) } as T);
      },
      async run() {
        log.push(sql);
        return db.prepare(sql).run(...(values as never[]));
      },
    };
  }

  // Batches run one at a time. Each awaits between statements, and on a single
  // connection a second batch's BEGIN would land inside the first's
  // transaction. D1 runs every batch atomically, so concurrent requests
  // (test/worker-concurrency.test.ts) need the same here.
  let batchQueue: Promise<unknown> = Promise.resolve();

  async function runBatch(statements: D1PreparedStatement[]) {
    // D1 runs a batch as one transaction; match that so a failing statement
    // cannot leave a half-written document behind.
    db.exec("BEGIN");
    try {
      const out: unknown[] = [];
      for (const s of statements) out.push(await s.run());
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  return {
    prepare: (sql: string) => statement(sql),
    batch(statements: D1PreparedStatement[]) {
      const result = batchQueue.then(() => runBatch(statements));
      batchQueue = result.catch(() => {});
      return result;
    },
    log,
    resetLog() { log.length = 0; },
    raw: db,
    close() { db.close(); },
  };
}
