// Cloudflare D1 adapter.
//
// WHY MATCHES LIVE IN THEIR OWN TABLE
//
// The live database is 673 KB compact, and 647 KB of that — 96.1% across 374
// matches — is the matches array. Everything else together is 26 KB.
//
// That matters twice over:
//
//   1. D1 caps the size of a single stored value. A document that is already
//      two thirds of a megabyte and grows by ~1.7 KB per ranked game is a
//      deadline, not a design.
//   2. On the filesystem backend, logging one match rewrites the entire file.
//      At 374 matches that is already silly, and it gets worse every game.
//
// So the adapter splits on the way down and rejoins on the way up: the
// document row holds seasons / goals / settings / notifications, and each
// match is its own row. Callers never see this. read("live") returns the same
// shape store.ts has always been handed, matches array included.
//
// The split is also why flush() diffs: adding one game writes one row, not 374.

import type { DocKey, DocumentStore } from "./contract.ts";

// Minimal structural types for the D1 binding, so this file does not need
// @cloudflare/workers-types to typecheck under the Node tsconfig.
export interface D1Result<T = unknown> { results: T[]; }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

interface MatchLike { id: string; [k: string]: unknown; }
interface DocLike { matches?: MatchLike[]; [k: string]: unknown; }

interface Snapshot {
  /** Document body as stored, WITHOUT the matches array. */
  body: Record<string, unknown> | null;
  /** Match id -> serialised match, as hydrated. Used to diff on flush. */
  matches: Map<string, string>;
  /** Match id -> position, as hydrated. A move is a write, same as an edit. */
  order: Map<string, number>;
  existed: boolean;
}

export function createD1Store(db: D1Database): DocumentStore {
  // What we loaded, so flush() can tell what actually changed.
  const snapshots = new Map<DocKey, Snapshot>();
  // What callers have written since hydrate.
  const staged = new Map<DocKey, DocLike>();

  function requireHydrated(key: DocKey): Snapshot {
    const snap = snapshots.get(key);
    if (!snap) {
      // Deliberately loud. A silent null here is indistinguishable from "new
      // user, empty database", and the next flush would persist that emptiness
      // over real data.
      throw new Error(
        `document "${key}" was read before hydrate(). Add it to the hydrate() key set.`
      );
    }
    return snap;
  }

  function currentDoc(key: DocKey): DocLike | null {
    if (staged.has(key)) return staged.get(key)!;
    const snap = requireHydrated(key);
    if (!snap.existed || !snap.body) return null;

    // Only re-attach `matches` if this document actually has match rows.
    // Documents that never carried the key (meta, profile) must come back
    // without it — inventing an empty array here is a silent divergence from
    // the filesystem adapter, and the contract suite catches exactly that.
    // An empty-but-present array survives inside the body itself; see flush().
    if (snap.matches.size === 0) return { ...snap.body };

    const matches = [...snap.matches.values()].map(m => JSON.parse(m) as MatchLike);
    return { ...snap.body, matches };
  }

  return {
    read<T>(key: DocKey): T | null {
      return currentDoc(key) as T | null;
    },

    write(key: DocKey, value: unknown): void {
      requireHydrated(key);
      staged.set(key, (value ?? {}) as DocLike);
    },

    exists(key: DocKey): boolean {
      if (staged.has(key)) return true;
      return requireHydrated(key).existed;
    },

    async hydrate(keys?: DocKey[]): Promise<void> {
      const wanted = keys ?? await allKeys(db);
      for (const key of wanted) {
        if (snapshots.has(key)) continue;

        const row = await db
          .prepare("SELECT body FROM documents WHERE doc_key = ?")
          .bind(key)
          .first<{ body: string }>();

        const matchRows = await db
          .prepare("SELECT match_id, body FROM matches WHERE doc_key = ? ORDER BY ord")
          .bind(key)
          .all<{ match_id: string; body: string }>();

        const matches = new Map<string, string>();
        const order = new Map<string, number>();
        matchRows.results.forEach((r, i) => {
          matches.set(r.match_id, r.body);
          order.set(r.match_id, i);
        });

        let body: Record<string, unknown> | null = null;
        if (row) {
          try {
            body = JSON.parse(row.body) as Record<string, unknown>;
          } catch {
            // Same posture as the fs adapter: unreadable reads as absent.
            body = null;
          }
        }

        snapshots.set(key, { body, matches, order, existed: row != null });
      }
    },

    async flush(): Promise<void> {
      const statements: D1PreparedStatement[] = [];
      const now = Math.floor(Date.now() / 1000);

      for (const [key, doc] of staged) {
        const snap = snapshots.get(key)!;

        // Document row: everything except a non-empty matches array.
        //
        // An empty array stays in the body on purpose. It is the only way to
        // tell "this document has no games yet" apart from "this document has
        // no matches key at all", since both produce zero match rows.
        const { matches: incomingMatches, ...withoutMatches } = doc;
        const rest: Record<string, unknown> =
          Array.isArray(incomingMatches) && incomingMatches.length === 0
            ? { ...withoutMatches, matches: [] }
            : withoutMatches;
        const bodyText = JSON.stringify(rest);
        if (!snap.existed || JSON.stringify(snap.body ?? {}) !== bodyText) {
          statements.push(
            db.prepare(
              `INSERT INTO documents (doc_key, body, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(doc_key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
            ).bind(key, bodyText, now)
          );
        }

        // Match rows: insert/update the changed ones, delete the removed ones.
        const incoming = new Map<string, string>();
        for (const m of incomingMatches ?? []) {
          if (!m || typeof m.id !== "string") continue;
          incoming.set(m.id, JSON.stringify(m));
        }

        let ord = 0;
        for (const [id, text] of incoming) {
          const position = ord++;
          // Rewrite the row if the body changed OR the match moved position:
          // the engine reads this array in order, so a reorder is a real edit.
          if (snap.matches.get(id) === text && snap.order.get(id) === position) continue;
          statements.push(
            db.prepare(
              `INSERT INTO matches (doc_key, match_id, ord, body, updated_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(doc_key, match_id) DO UPDATE SET
                 ord = excluded.ord, body = excluded.body, updated_at = excluded.updated_at`
            ).bind(key, id, position, text, now)
          );
        }

        for (const id of snap.matches.keys()) {
          if (incoming.has(id)) continue;
          statements.push(
            db.prepare("DELETE FROM matches WHERE doc_key = ? AND match_id = ?").bind(key, id)
          );
        }

        // The staged doc becomes the new baseline, so a second flush with no
        // further writes is a no-op rather than a full rewrite.
        snap.body = rest;
        snap.matches = incoming;
        snap.order = new Map([...incoming.keys()].map((id, i) => [id, i]));
        snap.existed = true;
      }

      if (statements.length) await db.batch(statements);
      staged.clear();
    },

    hydratedKeys(): DocKey[] {
      return [...snapshots.keys()];
    },
  };
}

async function allKeys(db: D1Database): Promise<DocKey[]> {
  const rows = await db.prepare("SELECT doc_key FROM documents").all<{ doc_key: string }>();
  return rows.results.map(r => r.doc_key as DocKey);
}
