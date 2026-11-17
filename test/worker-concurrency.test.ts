// The Worker entry under concurrent requests.
//
// One Cloudflare isolate serves several requests at once, and the SPA fires a
// handful of API calls together on every page load. When the document store
// was one process-wide variable, a request that installed its store while
// another was still awaiting hydrate() hijacked the other's reads. The other
// request then failed with 'document "live" was read before hydrate()' or, with
// two different users, read the second user's documents.
//
// This drives the real onRequest (server/worker.ts) over the SQLite D1 shim
// with two signed-in users, interleaving their requests, and checks that every
// request succeeds and sees only its own user's data.
//
// Run with:  npm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { onRequest, type Env } from "../server/worker.ts";
import type { D1Database, D1PreparedStatement } from "../server/storage/d1Store.ts";
import { createSqliteD1 } from "./d1-sqlite-shim.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(__dirname, "..", "migrations", "0001_league_ify.sql"), "utf8");

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${(err as Error).message.split("\n").join("\n      ")}`);
    process.exitCode = 1;
  }
}

const db = createSqliteD1(SCHEMA);
const now = Math.floor(Date.now() / 1000);
const users = [
  { id: 1, email: "a@example.test", session: "session-a", marker: "user-a" },
  { id: 2, email: "b@example.test", session: "session-b", marker: "user-b" },
];
for (const u of users) {
  db.raw.prepare(
    "INSERT INTO lu_users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, 'x', ?, ?)"
  ).run(u.id, u.email, now, now);
  db.raw.prepare(
    "INSERT INTO lu_sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).run(u.session, u.id, now, now + 3600, now);
  // Each user's own profile document, tagged so a response shows whose it is.
  db.raw.prepare("INSERT INTO documents (doc_key, body, updated_at) VALUES (?, ?, ?)")
    .run(`u/${u.id}/profile`, JSON.stringify({ marker: u.marker }), now);
}

// Real D1 calls cross the network, so requests overlap in uneven ways. Delay
// each query by a varying few milliseconds to get the same interleavings here.
let calls = 0;
const latency = () => new Promise(r => setTimeout(r, calls++ % 4));
function withLatency(stmt: D1PreparedStatement): D1PreparedStatement {
  return {
    bind: (...v: unknown[]) => withLatency(stmt.bind(...v)),
    all: async <T>() => { await latency(); return stmt.all<T>(); },
    first: async <T>() => { await latency(); return stmt.first<T>(); },
    run: async () => { await latency(); return stmt.run(); },
  };
}
const slowDb: D1Database = {
  prepare: (sql: string) => withLatency(db.prepare(sql)),
  batch: async (s: D1PreparedStatement[]) => { await latency(); return db.batch(s); },
};

const env = { DB: slowDb } as unknown as Env;

function get(path: string, session: string) {
  const request = new Request(`https://dhole.dev/api/league-ify/${path}`, {
    headers: { Cookie: `__Host-lu_session=${session}` },
  });
  return onRequest({ request, env, params: { path: path.split("/") } });
}

console.log("\nworker: concurrent requests\n");

await test("one request on its own reads its user's profile", async () => {
  const res = await get("profile", "session-a");
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).marker, "user-a");
});

await test("interleaved requests from two users each succeed and see only their own data", async () => {
  // Fired together, the way the SPA does on load. Alternating users makes each
  // request's hydrate() overlap the other user's.
  const order = [0, 1, 0, 1, 1, 0, 0, 1];
  const responses = await Promise.all(order.map(i => get("profile", users[i].session)));
  const bodies = await Promise.all(responses.map(r => r.text()));
  order.forEach((i, n) => {
    assert.equal(responses[n].status, 200, `request ${n} (${users[i].marker}): ${bodies[n]}`);
    assert.equal(JSON.parse(bodies[n]).marker, users[i].marker, `request ${n} got another user's profile`);
  });
});

await test("interleaved requests from one user all succeed", async () => {
  const paths = ["profile", "seasons", "profile", "seasons", "profile"];
  const responses = await Promise.all(paths.map(p => get(p, "session-a")));
  for (const [n, r] of responses.entries()) {
    assert.equal(r.status, 200, `${paths[n]}: ${await r.text()}`);
  }
});

db.close();
console.log(`\n${passed} passed\n`);
