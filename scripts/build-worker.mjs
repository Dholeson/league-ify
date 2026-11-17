// Bundle the Cloudflare Pages Function for league-ify's API into a single ESM
// file, so the dhole.dev site can vendor one artifact instead of the whole
// server/ tree (the same "compile and commit" pattern the site already uses for
// projects/gen1/parser).
//
//   node scripts/build-worker.mjs      (standalone)
//   import { buildWorker } ...          (from build-site.mjs)
//
// Output: dist/worker/league-ify-api.mjs — copied into the site as
// functions/api/league-ify/[[path]].js by scripts/build-site.mjs.
//
// node:* built-ins are left external; the Cloudflare runtime provides them via
// the `nodejs_compat` flag (AsyncLocalStorage in activeProfile.ts needs it). The
// filesystem adapter (fsStore) is pulled in by storage/index.ts but never called
// on the Worker, so its node:fs import only needs to resolve, not run. lcu.ts
// (local League-client reader) is swapped for a stub, removing node:child_process
// and node:https, which Cloudflare does not provide.

import * as esbuild from "esbuild";
import path from "node:path";

export const WORKER_OUTFILE = "dist/worker/league-ify-api.mjs";

// Replace lcu.ts with the "no client" stub for the Worker build.
const stubLcu = {
  name: "stub-lcu",
  setup(build) {
    build.onResolve({ filter: /(^|\/)lcu\.ts$/ }, () => ({
      path: path.resolve("server/lcu.worker-stub.ts"),
    }));
  },
};

export async function buildWorker() {
  const result = await esbuild.build({
    entryPoints: ["server/worker.ts"],
    outfile: WORKER_OUTFILE,
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["module", "main"],
    external: ["node:*"],
    plugins: [stubLcu],
    // On workerd import.meta.url is undefined, so the top-level
    // `fileURLToPath(import.meta.url)` in fsStore / the LLM cache modules throws
    // at init and the whole Worker fails to load. Those paths are only used for
    // the on-disk JSON caches, which never run on the Worker (the fs calls are
    // guarded), so a dummy file URL keeps module init from throwing.
    define: { "import.meta.url": JSON.stringify("file:///worker.mjs") },
    legalComments: "none",
    logLevel: "info",
    metafile: true,
  });
  const out = result.metafile.outputs[WORKER_OUTFILE.replace(/\//g, path.sep)] ??
    result.metafile.outputs[WORKER_OUTFILE];
  if (out) console.log(`worker bundle: ${(out.bytes / 1024).toFixed(0)} KB`);
  return WORKER_OUTFILE;
}

// Run directly => build once.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-worker.mjs")) {
  await buildWorker();
}
