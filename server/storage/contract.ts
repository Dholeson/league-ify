// The storage contract.
//
// WHY THIS EXISTS
//
// store.ts is 1072 lines and ~50 methods, and every one of them is
// SYNCHRONOUS. So is every one of the 55 route handlers in index.ts, and all
// fourteen modules under server/engine/. That is fine on Node, where the whole
// database is one JSON file read with readFileSync.
//
// It is not fine on Cloudflare D1, which is async. The naive port makes
// store.read() async, which makes every caller async, which makes every
// handler async, which is a viral change across the entire codebase for what
// is really a plumbing detail.
//
// The way out is that store.ts does not actually use the filesystem in fifty
// places. It uses it in three:
//
//     read(key)   -> parsed document or null
//     write(key, value)
//     exists(key)
//
// Eleven call sites, all inside store.ts. Everything above that line is pure
// synchronous logic over an in-memory object, and store.ts already keeps
// liveCache / demoCache / profileCache / metaCache to avoid re-reading.
//
// So: keep read/write/exists synchronous, and put the async at the edges.
// hydrate() pulls the documents a request needs into memory before any handler
// runs; flush() writes back what changed after they finish. The 50 methods,
// the 55 handlers, and the engine never learn that the backend changed.
//
// This is the same shape the Node version already had — it just makes the
// load-once/save-at-the-end boundary explicit instead of implicit in fs calls.

import type { Profile } from "../../shared/types.ts";

// Documents are addressed by a logical key, never a filesystem path. The
// Node adapter maps these onto files under data/; the D1 adapter maps them
// onto rows. Nothing above the adapter should know which.
//
//   "live"              the real database
//   "demo"              the demo database
//   "profile"           the operator's own Profile
//   "meta"              small flags (demo mode on/off)
//   "profiles/<key>"    a searched Riot ID's own database
export type DocKey = "live" | "demo" | "profile" | "meta" | `profiles/${string}`;

export function profileDocKey(key: string): DocKey {
  return `profiles/${key}`;
}

// Keys always loaded, whatever the request is doing. The active profile's key
// gets appended by the caller once it knows which profile is being viewed —
// see resolveKeys().
export const ALWAYS_HYDRATE: DocKey[] = ["meta", "profile"];

export interface DocumentStore {
  /**
   * Read a hydrated document. SYNCHRONOUS by design — see the note above.
   *
   * Returns null if the document does not exist. An adapter whose backend is
   * async MUST have had the key passed to hydrate() first; reading a
   * non-hydrated key from such an adapter is a programming error and throws
   * rather than silently returning null, because a silent null here looks
   * exactly like "new user, empty database" and would quietly wipe real data
   * on the next flush.
   */
  read<T>(key: DocKey): T | null;

  /** Stage a document. Durable only after flush() for async adapters. */
  write(key: DocKey, value: unknown): void;

  /** Whether the document exists. Same hydration rule as read(). */
  exists(key: DocKey): boolean;

  /**
   * Load the given documents into memory. Called once, before handlers run.
   * Passing no keys means "everything", which is what local dev and the tests
   * use; the Worker passes an explicit set so it does not parse profiles the
   * request will never touch.
   */
  hydrate(keys?: DocKey[]): Promise<void>;

  /** Persist everything written since the last flush. */
  flush(): Promise<void>;

  /** Keys currently in memory. Diagnostics and tests. */
  hydratedKeys(): DocKey[];
}

/**
 * The document set a request needs: the always-on pair, whichever database is
 * active, and the viewed profile if it is not the operator's own.
 *
 * Kept here rather than in the Worker so both adapters and the tests agree on
 * what "enough" means.
 */
export function resolveKeys(opts: {
  demoMode: boolean;
  activeProfileKey?: string | null;
  isSelf?: boolean;
}): DocKey[] {
  const keys: DocKey[] = [...ALWAYS_HYDRATE];
  keys.push(opts.demoMode ? "demo" : "live");
  if (!opts.isSelf && opts.activeProfileKey) keys.push(profileDocKey(opts.activeProfileKey));
  return keys;
}

// A document that has never been written is distinct from one written as null.
// Adapters store this sentinel for the former so exists() and read() cannot
// disagree.
export const MISSING = Symbol("missing-document");

export type StoredProfile = Profile;
