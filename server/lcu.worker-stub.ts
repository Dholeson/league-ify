// Worker-build replacement for lcu.ts.
//
// The real lcu.ts reads the local League client — its lockfile (node:fs) and
// its localhost APIs (node:https), and probes the process (node:child_process).
// None of that exists on Cloudflare, and the live companion is inherently a
// local-play feature, so on the hosted server we always report "no client
// detected": the exact shape the real readLiveState() returns when League is
// not running. liveStatus() then reports clientDetected:false and
// buildLiveCompanion() produces its empty "no game" readout.
//
// esbuild rewrites every ./lcu.ts import to this file (see
// scripts/build-worker.mjs); this stub imports nothing from lcu.ts, so there is
// no cycle, and the `type RawLiveState` import on the caller is type-only and
// erased by esbuild.

export async function readLiveState() {
  return {
    clientDetected: false,
    phase: "None",
    queueId: null,
    gameMode: null,
    source: null,
    mineKey: null,
    myRole: null,
    allies: [],
    enemies: [],
  };
}
