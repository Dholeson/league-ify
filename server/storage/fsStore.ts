// Filesystem adapter — the behaviour league-ify has always had.
//
// This is a straight extraction of the readJson / persistJson / existsSync
// calls that used to live inside store.ts. Nothing about how the Node server
// persists data changes: same files, same pretty-printed JSON, same lazy read
// and eager write. If this adapter ever behaves differently from the pre-port
// code, that is a bug, not an improvement.
//
// hydrate() and flush() are no-ops here on purpose. Local reads are synchronous
// and cheap, so there is nothing to pre-load, and writes already hit the disk
// immediately. The methods exist so the Node path and the Worker path satisfy
// one contract.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DocKey, DocumentStore } from "./contract.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = resolve(__dirname, "..", "..", "data");

// The logical-key -> file mapping. Previously these paths were scattered as
// module constants in store.ts; they are the adapter's business now.
function fileFor(dataDir: string, key: DocKey): string {
  switch (key) {
    case "live":    return resolve(dataDir, "league-ify.json");
    case "demo":    return resolve(dataDir, "league-ify.demo.json");
    case "profile": return resolve(dataDir, "league-ify.profile.json");
    case "meta":    return resolve(dataDir, "league-ify.meta.json");
    default: {
      if (!key.startsWith("profiles/")) throw new Error(`unknown document key: ${key}`);
      const name = key.slice("profiles/".length);
      // A profile key becomes a filename, so it must not be able to climb out
      // of data/profiles/. Riot IDs are normalised upstream, but this adapter
      // is the last place that could stop a traversal and it costs nothing.
      if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`unsafe profile key: ${name}`);
      return resolve(dataDir, "profiles", `${name}.json`);
    }
  }
}

function ensureDirFor(file: string) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// dataDir is overridable so tests can run the contract suite against a temp
// directory instead of the operator's real data/. Production never passes it.
export function createFsStore(dataDir: string = DEFAULT_DATA_DIR): DocumentStore {
  const fileFor_ = (key: DocKey) => fileFor(dataDir, key);

  return {
    read<T>(key: DocKey): T | null {
      const file = fileFor_(key);
      if (!existsSync(file)) return null;
      try {
        return JSON.parse(readFileSync(file, "utf8")) as T;
      } catch {
        // Matches the old behaviour: a corrupt file reads as absent rather
        // than crashing the server on boot.
        return null;
      }
    },

    write(key: DocKey, value: unknown): void {
      const file = fileFor_(key);
      ensureDirFor(file);
      writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
    },

    exists(key: DocKey): boolean {
      return existsSync(fileFor_(key));
    },

    async hydrate(): Promise<void> {},
    async flush(): Promise<void> {},

    hydratedKeys(): DocKey[] {
      // Nothing is held in memory here, so "hydrated" means "on disk".
      const keys: DocKey[] = [];
      for (const k of ["live", "demo", "profile", "meta"] as DocKey[]) {
        if (existsSync(fileFor_(k))) keys.push(k);
      }
      return keys;
    },
  };
}
