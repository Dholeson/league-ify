// Progressive data pull. Each sync fetches a bounded batch of games and reports
// how many it still knows about but hasn't fetched (`remaining`, from a
// server-side persisted queue). We keep syncing until that's 0, so recent games
// appear immediately and the rest fill in behind a "still pulling…" banner.
// Rate-limit-safe: 429s pause the drain, and a big backlog resumes over time
// (the queue survives on the server, so a reload picks up where it left off).

import { api } from "./api.ts";

export type PullState = { active: boolean; remaining: number; added: number; rateLimited: boolean };

let state: PullState = { active: false, remaining: 0, added: 0, rateLimited: false };
let looping = false;
let resumeTimer: number | undefined;
const listeners = new Set<(s: PullState) => void>();

function set(patch: Partial<PullState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function subscribePull(l: (s: PullState) => void): () => void {
  listeners.add(l);
  l(state);
  return () => { listeners.delete(l); };
}

// Lets a page seed the banner immediately (e.g. the dashboard knows the pending
// count before the first sync returns) and kick off a resume.
export function noteRemaining(remaining: number) {
  if (remaining > 0 && !state.active) set({ active: true, remaining });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_CONSECUTIVE_LIMITED = 8; // ~4 min of solid rate-limiting → pause, resume later

// Drain the backlog. The first call honors `force` (so a routine auto-load
// respects the hourly gate); once there's a known backlog, later batches force
// through the gate. On a persistent rate limit it pauses and schedules a resume
// so a 600-game pull finishes over the following minutes instead of giving up.
export async function drainPull({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (looping) return;
  if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = undefined; }
  looping = true;
  set({ active: true, added: 0, rateLimited: false });
  let remaining = state.remaining;
  let ended: "done" | "limited" | "error" = "done";
  try {
    let first = true;
    let limitedStreak = 0;
    for (let guard = 0; guard < 2000; guard++) {
      let r;
      try {
        r = await api.sync(force || !first);
      } catch {
        ended = "error";
        break;
      }
      first = false;
      if (r.skipped) { ended = "done"; break; }
      if (r.added > 0) window.dispatchEvent(new Event("data:refresh"));
      remaining = r.remaining ?? remaining;
      set({ remaining, added: state.added + (r.added ?? 0), rateLimited: !!r.rateLimited });
      if (r.error) { ended = "error"; break; }
      if (r.rateLimited) {
        // A 429 can zero `remaining` (it fired before we enumerated), so never
        // treat rate-limited as "done" — back off and resume.
        if (++limitedStreak >= MAX_CONSECUTIVE_LIMITED) { ended = "limited"; break; }
        await sleep(25000);
        continue;
      }
      limitedStreak = 0;
      if (remaining <= 0) { ended = "done"; break; }
      await sleep(2500);
    }
  } finally {
    looping = false;
    window.dispatchEvent(new Event("data:refresh"));
    window.dispatchEvent(new Event("notif:refresh"));
    if (ended === "done" && remaining <= 0) {
      set({ active: false, remaining: 0, rateLimited: false });
    } else if (ended !== "error") {
      // Backlog left or rate-limited — keep the banner up and resume shortly.
      set({ active: true, remaining: Math.max(remaining, 1), rateLimited: false });
      resumeTimer = window.setTimeout(() => drainPull({ force: true }), 45000);
    } else {
      set({ active: false, remaining: 0, rateLimited: false });
    }
  }
}
