// Build the hosted (dhole.dev) artifacts and vendor them into the site repo.
//
//   node scripts/build-site.mjs            # assumes ../site
//   node scripts/build-site.mjs ../path/to/site
//   SITE_DIR=../site node scripts/build-site.mjs
//
// Produces two things and copies them into the Cloudflare Pages site, the same
// "compile and commit" pattern the site uses for projects/gen1:
//
//   dist/site/*                         -> <site>/projects/league-ify/
//     the React SPA, built with base "/projects/league-ify/" and its API client
//     pointed at /api/league-ify (vite.config, BUILD_TARGET=site).
//
//   dist/worker/league-ify-api.mjs      -> <site>/functions/api/league-ify/[[path]].js
//     the API as one Pages Function bundle.
//
// After running this: review the diff in the site repo, commit, and deploy with
// `wrangler pages deploy .` from there.

import { build as viteBuild } from "vite";
import { rm, cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorker, WORKER_OUTFILE } from "./build-worker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_DIR = path.resolve(
  ROOT,
  process.argv[2] || process.env.SITE_DIR || "../site"
);

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

if (!(await exists(SITE_DIR))) {
  console.error(`site directory not found: ${SITE_DIR}`);
  console.error("Pass it as an argument or set SITE_DIR.");
  process.exit(1);
}

// 1. SPA — hosted shape.
process.env.BUILD_TARGET = "site";
console.log("building the SPA (base /projects/league-ify/)...");
await viteBuild({ root: ROOT, configFile: path.join(ROOT, "vite.config.ts") });

// 2. API Worker bundle.
console.log("bundling the API Worker...");
await buildWorker();

// 3. Vendor into the site.
const spaDest = path.join(SITE_DIR, "projects", "league-ify");
const fnDest = path.join(SITE_DIR, "functions", "api", "league-ify");

console.log(`\nvendoring into ${SITE_DIR} ...`);
await rm(spaDest, { recursive: true, force: true });
await mkdir(spaDest, { recursive: true });
await cp(path.join(ROOT, "dist", "site"), spaDest, { recursive: true });
console.log(`  SPA      -> projects/league-ify/`);

await mkdir(fnDest, { recursive: true });
await cp(path.join(ROOT, WORKER_OUTFILE), path.join(fnDest, "[[path]].js"));
console.log(`  API func -> functions/api/league-ify/[[path]].js`);

console.log("\ndone. Review the diff in the site repo, commit, and deploy.");
