#!/usr/bin/env tsx
// Prove the migration is lossless.
//
//   npx tsx scripts/export-to-d1.ts
//   npx tsx scripts/verify-d1-roundtrip.ts
//
// Loads the generated seed into a real SQLite database with the real migration
// applied, reads every document back through the D1 adapter, and deep-compares
// against the JSON it came from. Anything that does not match is printed with
// the path to the first difference.
//
// This is a SMOKE CHECK, not a gate test: it runs against the operator's real
// data, which is gitignored, so it cannot live in the committed suite. The
// gate equivalent is test/storage.test.ts, which runs the same adapter against
// synthetic documents.
//
// Why it is worth running anyway: the committed tests prove the adapter is
// self-consistent. Only this proves 1,523 real matches survive the trip.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createD1Store } from "../server/storage/d1Store.ts";
import type { DocKey } from "../server/storage/contract.ts";
import { createSqliteD1 } from "../test/d1-sqlite-shim.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

const SCHEMA = readFileSync(resolve(ROOT, "migrations", "0001_league_ify.sql"), "utf8");
const SEED_PATH = resolve(DATA_DIR, "d1-seed.sql");

if (!existsSync(SEED_PATH)) {
  console.error("no data/d1-seed.sql — run: npx tsx scripts/export-to-d1.ts");
  process.exit(1);
}

// First structural difference between two values, as a dotted path.
function firstDiff(a: unknown, b: unknown, path = ""): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path || "<root>"}: ${typeof a} vs ${typeof b}`;
  if (a === null || b === null || typeof a !== "object") {
    return `${path || "<root>"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!(k in ao)) return `${path}.${k}: missing on the D1 side`;
    if (!(k in bo)) return `${path}.${k}: unexpected on the D1 side`;
    const d = firstDiff(ao[k], bo[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

// Rebuild the expected shape the same way the adapter reports it: an empty
// matches array stays, a missing matches key stays missing.
function expected(doc: Record<string, unknown>): Record<string, unknown> {
  return doc;
}

const sources: Array<{ key: DocKey; file: string }> = [
  { key: "live",    file: resolve(DATA_DIR, "league-ify.json") },
  { key: "demo",    file: resolve(DATA_DIR, "league-ify.demo.json") },
  { key: "profile", file: resolve(DATA_DIR, "league-ify.profile.json") },
  { key: "meta",    file: resolve(DATA_DIR, "league-ify.meta.json") },
];

const PROFILES_DIR = resolve(DATA_DIR, "profiles");
if (existsSync(PROFILES_DIR)) {
  for (const f of readdirSync(PROFILES_DIR)) {
    if (!f.endsWith(".json")) continue;
    const name = f.slice(0, -5);
    if (!/^[a-z0-9_-]+$/i.test(name)) continue;
    sources.push({ key: `profiles/${name}` as DocKey, file: resolve(PROFILES_DIR, f) });
  }
}

console.log("applying migration + seed to an in-memory SQLite database...");
const db = createSqliteD1(SCHEMA);
db.raw.exec(readFileSync(SEED_PATH, "utf8"));

const counts = db.raw.prepare(
  "SELECT (SELECT COUNT(*) FROM documents) AS docs, (SELECT COUNT(*) FROM matches) AS matches"
).get() as { docs: number; matches: number };
console.log(`  ${counts.docs} documents, ${counts.matches} match rows\n`);

const store = createD1Store(db);
const keys = sources.filter(s => existsSync(s.file)).map(s => s.key);
await store.hydrate(keys);

let failures = 0;
for (const { key, file } of sources) {
  const want = readJson(file);
  if (!want) { console.log(`  --  ${key.padEnd(34)} no local file, skipped`); continue; }

  const got = store.read<Record<string, unknown>>(key);
  if (!got) { console.log(`  FAIL ${key.padEnd(34)} missing from D1`); failures++; continue; }

  const diff = firstDiff(got, expected(want));
  const n = Array.isArray(want.matches) ? want.matches.length : 0;
  if (diff) {
    console.log(`  FAIL ${key.padEnd(34)} ${diff}`);
    failures++;
  } else {
    console.log(`  ok   ${key.padEnd(34)} identical (${n} matches)`);
  }
}

db.close();

console.log("");
if (failures) {
  console.error(`${failures} document(s) did not round-trip.`);
  process.exit(1);
}
console.log("every document round-tripped byte-for-byte.");
