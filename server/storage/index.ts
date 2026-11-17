// Picks an adapter and holds the one in use.
//
// store.ts imports `docs` from here and never learns which backend it got.
// Node keeps the filesystem for the whole process. The Worker gives each
// request its own D1 store with runWithDocumentStore(), before any handler runs.
//
// Why the Worker can't just swap a process-wide store: one isolate serves
// several requests concurrently. With a single `active` store, request B
// installing its store while request A was still awaiting hydrate() meant A's
// handlers then read B's store. That surfaced as 'document "live" was read before
// hydrate()' when B hadn't hydrated yet, and with two different users it would
// have served (or flushed) one user's documents in the other's request.

import { AsyncLocalStorage } from "node:async_hooks";
import type { DocKey, DocumentStore } from "./contract.ts";
import { createFsStore } from "./fsStore.ts";
import { createD1Store } from "./d1Store.ts";

let active: DocumentStore | null = null;
const requestStore = new AsyncLocalStorage<DocumentStore>();

/**
 * Run `fn` (and everything it awaits) against `store`. docs() inside returns
 * this store, whatever other requests are doing. The Worker's per-request entry.
 */
export function runWithDocumentStore<T>(store: DocumentStore, fn: () => T): T {
  return requestStore.run(store, fn);
}

/**
 * The adapter in use: the current request's, if one is running under
 * runWithDocumentStore(); otherwise the process-wide one, defaulting to the
 * filesystem so that running the Node server, a script, or a test needs no
 * setup and behaves exactly as it did before the port.
 */
export function docs(): DocumentStore {
  const scoped = requestStore.getStore();
  if (scoped) return scoped;
  if (!active) active = createFsStore();
  return active;
}

/** Drop the process-wide store (tests). Request-scoped stores are untouched. */
export function resetDocumentStore(): void {
  active = null;
}

export type { DocKey, DocumentStore };
export { createFsStore, createD1Store };
export { profileDocKey, resolveKeys, ALWAYS_HYDRATE } from "./contract.ts";
