// Picks an adapter and holds the one the process is using.
//
// store.ts imports `docs` from here and never learns which backend it got.
// Node keeps the filesystem; the Worker calls useDocumentStore() with a D1
// binding during request setup, before any handler runs.

import type { DocKey, DocumentStore } from "./contract.ts";
import { createFsStore } from "./fsStore.ts";
import { createD1Store, type D1Database } from "./d1Store.ts";

let active: DocumentStore | null = null;

/** Install a specific adapter. The Worker entry calls this per request. */
export function useDocumentStore(store: DocumentStore): DocumentStore {
  active = store;
  return store;
}

/** Install the D1 adapter for a request. */
export function useD1(db: D1Database): DocumentStore {
  return useDocumentStore(createD1Store(db));
}

/**
 * The adapter in use. Defaults to the filesystem so that running the Node
 * server, a script, or a test needs no setup and behaves exactly as it did
 * before the port.
 */
export function docs(): DocumentStore {
  if (!active) active = createFsStore();
  return active;
}

/** Tests and the Worker's per-request setup. */
export function resetDocumentStore(): void {
  active = null;
}

export type { DocKey, DocumentStore };
export { createFsStore, createD1Store };
export { profileDocKey, resolveKeys, ALWAYS_HYDRATE } from "./contract.ts";
