// Contract tests for the storage adapters.
//
// The point of this file is that BOTH adapters run the SAME suite. The whole
// port rests on the claim that swapping the filesystem for D1 does not change
// what store.ts sees; a shared suite is what turns that from a claim into a
// check.
//
// The D1 adapter is exercised against real SQLite with the real migration
// applied (test/d1-sqlite-shim.ts), so the CHECK constraints and upserts are
// genuinely running, not stubbed.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createFsStore } from "../server/storage/fsStore.ts";
import { createD1Store } from "../server/storage/d1Store.ts";
import { resolveKeys, profileDocKey } from "../server/storage/contract.ts";
import type { DocKey, DocumentStore } from "../server/storage/contract.ts";
import { createSqliteD1, type ShimDatabase } from "./d1-sqlite-shim.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(__dirname, "..", "migrations", "0001_league_ify.sql"), "utf8");

let passed = 0;
const cleanups: Array<() => void> = [];

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok  ${name}`); passed++; })
    .catch(err => { console.error(`FAIL  ${name}\n      ${err.message}`); process.exitCode = 1; });
}

// A document shaped like the real thing: a little metadata, a lot of matches.
function sampleDoc(matchIds: string[] = ["NA1_1", "NA1_2"]) {
  return {
    version: 1,
    seasons: [{ id: "s1", name: "Block 1" }],
    goals: [],
    settings: { tuning: { verdictGood: 65 } },
    matches: matchIds.map((id, i) => ({ id, win: i % 2 === 0, champion: "Ahri" })),
  };
}

// ── The shared suite ───────────────────────────────────────────────────────
//
// `fresh` returns a NEW adapter over the SAME backing store, which is how the
// suite checks that flush() actually persisted rather than just updating a
// cache.

async function runContract(
  label: string,
  make: () => Promise<{ store: DocumentStore; fresh: () => Promise<DocumentStore> }>
) {
  console.log(`\n  -- ${label} --`);

  await test(`${label}: missing document reads as null`, async () => {
    const { store } = await make();
    await store.hydrate(["live"]);
    assert.equal(store.read("live"), null);
    assert.equal(store.exists("live"), false);
  });

  await test(`${label}: write then read round-trips`, async () => {
    const { store } = await make();
    await store.hydrate(["live"]);
    store.write("live", sampleDoc());
    const got = store.read<ReturnType<typeof sampleDoc>>("live");
    assert.equal(got?.seasons[0].name, "Block 1");
    assert.equal(got?.matches.length, 2);
    assert.equal(store.exists("live"), true);
  });

  await test(`${label}: flush persists across a fresh adapter`, async () => {
    const { store, fresh } = await make();
    await store.hydrate(["live"]);
    store.write("live", sampleDoc(["NA1_1", "NA1_2", "NA1_3"]));
    await store.flush();

    const next = await fresh();
    await next.hydrate(["live"]);
    const got = next.read<ReturnType<typeof sampleDoc>>("live");
    assert.equal(got?.matches.length, 3);
    assert.deepEqual(got?.matches.map(m => m.id), ["NA1_1", "NA1_2", "NA1_3"]);
    assert.equal(got?.settings.tuning.verdictGood, 65);
  });

  await test(`${label}: adding a match preserves the others`, async () => {
    const { store, fresh } = await make();
    await store.hydrate(["live"]);
    store.write("live", sampleDoc(["NA1_1", "NA1_2"]));
    await store.flush();

    const next = await fresh();
    await next.hydrate(["live"]);
    const doc = next.read<ReturnType<typeof sampleDoc>>("live")!;
    doc.matches.push({ id: "NA1_9", win: true, champion: "Lux" });
    next.write("live", doc);
    await next.flush();

    const third = await fresh();
    await third.hydrate(["live"]);
    assert.deepEqual(
      third.read<ReturnType<typeof sampleDoc>>("live")?.matches.map(m => m.id),
      ["NA1_1", "NA1_2", "NA1_9"]
    );
  });

  await test(`${label}: deleting a match removes it`, async () => {
    const { store, fresh } = await make();
    await store.hydrate(["live"]);
    store.write("live", sampleDoc(["NA1_1", "NA1_2", "NA1_3"]));
    await store.flush();

    const next = await fresh();
    await next.hydrate(["live"]);
    const doc = next.read<ReturnType<typeof sampleDoc>>("live")!;
    doc.matches = doc.matches.filter(m => m.id !== "NA1_2");
    next.write("live", doc);
    await next.flush();

    const third = await fresh();
    await third.hydrate(["live"]);
    assert.deepEqual(
      third.read<ReturnType<typeof sampleDoc>>("live")?.matches.map(m => m.id),
      ["NA1_1", "NA1_3"]
    );
  });

  await test(`${label}: documents are independent`, async () => {
    const { store, fresh } = await make();
    const key = profileDocKey("hide_on_bush_kr1_kr");
    await store.hydrate(["live", "demo", key]);
    store.write("live", sampleDoc(["L1"]));
    store.write("demo", sampleDoc(["D1", "D2"]));
    store.write(key, sampleDoc(["P1", "P2", "P3"]));
    await store.flush();

    const next = await fresh();
    await next.hydrate(["live", "demo", key]);
    assert.equal(next.read<any>("live").matches.length, 1);
    assert.equal(next.read<any>("demo").matches.length, 2);
    assert.equal(next.read<any>(key).matches.length, 3);
  });

  await test(`${label}: a document with no matches round-trips`, async () => {
    const { store, fresh } = await make();
    await store.hydrate(["meta"]);
    store.write("meta", { demoMode: true });
    await store.flush();

    const next = await fresh();
    await next.hydrate(["meta"]);
    assert.deepEqual(next.read("meta"), { demoMode: true });
  });

  await test(`${label}: re-flushing without a write is a no-op`, async () => {
    const { store } = await make();
    await store.hydrate(["live"]);
    store.write("live", sampleDoc());
    await store.flush();
    await store.flush();          // must not throw or duplicate rows
    assert.equal(store.read<any>("live").matches.length, 2);
  });
}

// ── Adapter setups ─────────────────────────────────────────────────────────

async function main() {
  console.log("\nstorage contract\n");

  await runContract("fs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "league-ify-fs-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return {
      store: createFsStore(dir),
      fresh: async () => createFsStore(dir),
    };
  });

  await runContract("d1", async () => {
    const db = createSqliteD1(SCHEMA);
    cleanups.push(() => db.close());
    return {
      store: createD1Store(db),
      fresh: async () => createD1Store(db),
    };
  });

  // ── Adapter-specific guarantees ──────────────────────────────────────────

  console.log("\n  -- adapter specifics --");

  await test("d1: reading a non-hydrated key throws instead of returning null", async () => {
    // The whole reason this is loud: a silent null is indistinguishable from
    // "new user, empty database", and the next flush would write that over
    // real data.
    const db = createSqliteD1(SCHEMA);
    cleanups.push(() => db.close());
    const store = createD1Store(db);
    assert.throws(() => store.read("live"), /before hydrate/);
    assert.throws(() => store.exists("live"), /before hydrate/);
  });

  await test("d1: adding one match writes one match row, not all of them", async () => {
    // This is the reason matches are their own table. If this regresses,
    // logging a game rewrites two thirds of a megabyte again.
    const db = createSqliteD1(SCHEMA);
    cleanups.push(() => db.close());
    const store = createD1Store(db);
    await store.hydrate(["live"]);
    store.write("live", sampleDoc(["A", "B", "C", "D"]));
    await store.flush();

    db.resetLog();
    const doc = store.read<any>("live");
    doc.matches.push({ id: "E", win: true, champion: "Lux" });
    store.write("live", doc);
    await store.flush();

    const matchWrites = db.log.filter(s => s.includes("INTO matches")).length;
    assert.equal(matchWrites, 1, `expected 1 match write, got ${matchWrites}`);
  });

  await test("d1: the schema rejects an unknown document key", async () => {
    const db = createSqliteD1(SCHEMA);
    cleanups.push(() => db.close());
    await assert.rejects(
      db.prepare("INSERT INTO documents (doc_key, body, updated_at) VALUES (?, ?, ?)")
        .bind("not-a-real-key", "{}", 1).run(),
      /CHECK|constraint/i
    );
  });

  await test("fs: a profile key that could escape data/profiles is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "league-ify-fs-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const store = createFsStore(dir);
    assert.throws(() => store.read("profiles/../../etc/passwd" as DocKey), /unsafe profile key/);
  });

  await test("fs: a corrupt document reads as absent rather than throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "league-ify-fs-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const store = createFsStore(dir);
    store.write("live", sampleDoc());
    // Truncate the file to invalid JSON.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "league-ify.json"), "{ not json", "utf8");
    assert.equal(store.read("live"), null);
  });

  await test("resolveKeys asks for exactly what a request needs", () => {
    assert.deepEqual(resolveKeys({ demoMode: false, isSelf: true }), ["meta", "profile", "live"]);
    assert.deepEqual(resolveKeys({ demoMode: true, isSelf: true }), ["meta", "profile", "demo"]);
    assert.deepEqual(
      resolveKeys({ demoMode: false, isSelf: false, activeProfileKey: "dhole_na1_na1" }),
      ["meta", "profile", "live", "profiles/dhole_na1_na1"]
    );
  });

  for (const c of cleanups) { try { c(); } catch {} }
  console.log(`\n${passed} passed\n`);
}

main();
