import type { Match, Scorecard } from "../shared/types.ts";
import { store } from "./store.ts";
import { riotFromEnv, riotForAccount, RiotError } from "./riot.ts";
import { activeProfile } from "./activeProfile.ts";

// ---------------------------------------------------------------------------
// AUTO-INGESTION
//
// Pulls your recent ranked + ARAM games straight from Riot and stores them as
// objective-only career games — no manual logging. Deduped by match id,
// rate-limit aware (stops cleanly on 429 and resumes next sync), and gated so
// we don't hammer the API on every page load.
// ---------------------------------------------------------------------------

const uuid = () => globalThis.crypto.randomUUID();

const SYNC_QUEUES: { name: string; queue: number; ranked: boolean }[] = [
  { name: "Ranked solo", queue: 420, ranked: true },
  { name: "Ranked flex", queue: 440, ranked: true },
  { name: "Swiftplay", queue: 480, ranked: false },
  { name: "Draft", queue: 400, ranked: false },
  { name: "ARAM", queue: 450, ranked: false },
  { name: "Arena", queue: 1700, ranked: false },
];

const NEUTRAL_SCORECARD: Scorecard = {
  grade: "C",
  tiltBefore: 0,
  tiltAfter: 0,
  biggestMistake: "",
  firstDeathCause: null,
  bestDecision: "",
  oneAdjustment: "",
  doomedCollapse: false,
  flamed: false,
  mutedAppropriately: true,
  reviewed: false,
};

const MIN_INTERVAL_MS = 60 * 60 * 1000; // auto-sync at most hourly (manual bypasses)

export interface SyncResult {
  added: number;
  perQueue: Record<string, number>;
  skipped: boolean;
  error: string | null;
  lastSyncAt: string | null;
  rateLimited?: boolean;
  upgraded?: number; // existing games back-filled with the deep stat tree
  remaining?: number; // season games known but not yet fetched — drives the drain
}

export async function syncRiot(
  opts: { force?: boolean; perQueue?: number; maxNew?: number } = {}
): Promise<SyncResult> {
  const lastSyncAt = store.lastSyncAt();
  const base: SyncResult = { added: 0, perQueue: {}, skipped: false, error: null, lastSyncAt };
  let upgraded = 0;

  if (store.isDemo())
    return { ...base, skipped: true, error: "Demo mode — sync is off. Flip to live in Settings." };

  // Self syncs from the env account; a viewed profile syncs its own games.
  const ap = activeProfile();
  const riot = ap.isSelf
    ? riotFromEnv()
    : riotForAccount(ap.gameName!, ap.tagLine!, ap.platform!);
  if (!riot) return { ...base, skipped: true, error: "Riot API not configured." };

  // Respect the hourly auto-sync gate only when there's no backlog to drain —
  // a pending pull should keep going regardless of when we last synced.
  if (!opts.force && lastSyncAt && Date.now() - new Date(lastSyncAt).getTime() < MIN_INTERVAL_MS && store.pullPending().length === 0) {
    return { ...base, skipped: true };
  }

  // Fetch match details in bounded batches so a single sync stays under the dev
  // key's rate limit. The set of ids to fetch is a PERSISTED queue: we enumerate
  // (the expensive paginated id scan) only when the queue is empty, then just
  // drain details — otherwise every sync re-scanned the whole history and blew
  // the rate limit, stalling big pulls. `remaining` drives the client drain. The
  // pull is ALL-TIME (bounded); the season/all-time toggle filters the *view*.
  const maxNew = opts.maxNew ?? 25;
  const MAX_ENUM = 1500; // cap the persisted queue so huge accounts stay bounded
  const perQueue: Record<string, number> = {};
  let added = 0;
  let rateLimited = false;

  try {
    const puuid = await riot.getPuuid();
    let rank: Awaited<ReturnType<typeof riot.getRank>> = {};
    try {
      rank = await riot.getRank(puuid);
    } catch {
      /* rank is best-effort */
    }

    const pending = [...store.pullPending()];
    // Only enumerate when the queue is empty (fresh pull, or caught up and
    // looking for new games).
    //
    // FIRST pull (deep): paginate each queue to the END of its history (no early
    // stop — stored games can be a contiguous newest block, so an "all stored"
    // page doesn't mean deeper pages are). This is the expensive scan.
    //
    // INCREMENTAL top-up (once fully pulled, or the profile already has a real
    // history): scan only the newest games and stop at the first page that adds
    // nothing new — everything below is already stored. Without this, every
    // caught-up visit re-scanned the whole history, re-burned the rate limit, and
    // the drain read the 429 as "backlog remaining" and looped the banner.
    const incremental = store.pullComplete() || store.allMatches().length >= 50;
    if (pending.length === 0) {
      const pendingSet = new Set<string>();
      const collect = async (queue: number | undefined) => {
        for (let start = 0; start < MAX_ENUM && pending.length < MAX_ENUM; start += 100) {
          const ids = await riot.getRecentMatchIds(puuid, 100, queue, undefined, start);
          let newInPage = 0;
          for (const id of ids) {
            if (store.hasRiotMatch(id) || pendingSet.has(id)) continue;
            pendingSet.add(id);
            pending.push(id);
            newInPage++;
          }
          if (ids.length < 100) break; // reached the end of this queue's history
          // Incremental: the newest unstored games sit at the top, so the first
          // page with no new ids means we've reached already-pulled territory.
          if (incremental && newInPage === 0) break;
        }
      };
      for (const { queue } of SYNC_QUEUES) {
        try {
          await collect(queue);
        } catch (e) {
          if (e instanceof RiotError && e.status === 429) { rateLimited = true; break; }
        }
      }
      if (!rateLimited) {
        try {
          await collect(undefined); // rotating/limited modes not in SYNC_QUEUES
        } catch (e) {
          if (e instanceof RiotError && e.status === 429) rateLimited = true;
        }
      }
      // A clean enumeration (no 429) means we've now seen the full history — mark
      // it so future syncs top-up incrementally instead of deep-scanning again.
      if (!rateLimited) store.setPullComplete(true);
    }

    // Drain the queue: fetch details for up to maxNew games; the rest stay queued.
    const activeSeason = store.activeSeason();
    let processed = 0;
    const stillPending: string[] = [];
    for (const id of pending) {
      if (processed >= maxNew || rateLimited) { stillPending.push(id); continue; }
      try {
        const objective = await riot.getObjectiveData(id, puuid);
        // Stamp the queue-matching rank on ranked games (flex games get flex).
        const q = (objective.queue ?? "").toUpperCase();
        if (q.includes("RANKED")) {
          const r = q.includes("FLEX") ? (rank.flex ?? null) : (rank.solo ?? (rank.tier ? { tier: rank.tier, division: rank.division ?? "", leaguePoints: rank.leaguePoints ?? 0 } : null));
          if (r) {
            objective.tier = r.tier;
            objective.division = r.division;
            objective.leaguePoints = r.leaguePoints;
          }
        }
        store.addMatch({
          id: uuid(),
          seasonId: activeSeason?.id ?? null,
          playedAt: objective.playedAt ?? new Date().toISOString(),
          loggedAt: new Date().toISOString(),
          source: "riot",
          objective,
          scorecard: { ...NEUTRAL_SCORECARD },
        });
        added++;
        processed++;
        const name = q.includes("FLEX") ? "Ranked flex" : q.includes("SOLO") ? "Ranked solo" : q.includes("ARAM") ? "ARAM" : q.includes("ARENA") ? "Arena" : "Other";
        perQueue[name] = (perQueue[name] ?? 0) + 1;
      } catch (e) {
        if (e instanceof RiotError && e.status === 429) { rateLimited = true; stillPending.push(id); continue; }
        // A non-rate-limit failure (un-fetchable match) — drop it so it can't
        // block the queue forever.
      }
    }
    store.setPullPending(stillPending);

    // Back-fill the deep stat tree only once the pull has caught up, so new
    // games always take priority over upgrading old ones.
    if (!rateLimited && stillPending.length === 0) {
      const budget = Math.max(0, Math.min(20, maxNew - processed));
      // A game needs the deep tree if it has no `adv` at all, or (for a team
      // mode) it predates fight parsing — i.e. `adv` exists but the fight fields
      // don't. Arena legitimately has no fights, so it never re-qualifies.
      const needsUpgrade = (m: Match) => {
        if (m.source !== "riot" || !m.objective.riotMatchId) return false;
        if (!m.objective.build) return true; // build/runes/summoners added later
        const a = m.objective.adv;
        if (!a) return true;
        const isArena = (m.objective.queue ?? "").includes("ARENA");
        return !isArena && a.duels === undefined;
      };
      const stale = store
        .allMatches()
        .filter(needsUpgrade)
        .sort((a, b) => (b.playedAt ?? "").localeCompare(a.playedAt ?? "")) // newest first
        .slice(0, budget);
      for (const m of stale) {
        try {
          const fresh = await riot.getObjectiveData(m.objective.riotMatchId!, puuid);
          // fresh recomputes the base fields + adds adv/placement; it never sets
          // rank stamps, so spreading existing first keeps tier/LP/lpDelta.
          store.updateMatch(m.id, { objective: { ...m.objective, ...fresh } });
          upgraded++;
        } catch (e) {
          if (e instanceof RiotError && e.status === 429) {
            rateLimited = true;
            break;
          }
        }
      }
    }

    if (rank.leaguePoints != null) {
      store.updateSettings({
        lastLp: rank.leaguePoints,
        lastTier: rank.tier ?? null,
        lastDivision: rank.division ?? null,
      });
    }
    const iso = new Date().toISOString();
    store.setLastSyncAt(iso);
    return { added, perQueue, skipped: false, error: null, lastSyncAt: iso, rateLimited, upgraded, remaining: stillPending.length };
  } catch (e) {
    // A 429 from getPuuid/getRank is a soft pause, not a hard failure — surface
    // it as rateLimited (no error) so the drain backs off and resumes.
    const is429 = e instanceof RiotError && e.status === 429;
    return {
      added,
      perQueue,
      skipped: false,
      error: is429 ? null : String((e as Error).message),
      lastSyncAt: store.lastSyncAt(),
      rateLimited: is429 || rateLimited,
      upgraded,
      remaining: store.pullPending().length,
    };
  }
}
