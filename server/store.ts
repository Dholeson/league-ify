import { docs, profileDocKey } from "./storage/index.ts";
import type { DocKey } from "./storage/index.ts";
import type { Season, Match, Profile, Goal, Tuning, Scorecard, ObjectiveData, NextGamePlan, FavoriteProfile, ChampionPoolEntry, NotificationItem, Role, PoolTier } from "../shared/types.ts";

// Derive a champion pool from a profile's games: any champion with enough games
// is auto-included (tiered by volume), in its most-played role. Manually-added
// entries are merged on top (their tier/roles win). This makes the pool
// profile-specific and populated without the user hand-curating it.
function derivePool(matches: Match[], manual: ChampionPoolEntry[]): ChampionPoolEntry[] {
  const MIN_GAMES = 3;
  const byChamp = new Map<string, { roles: Map<Role, number>; total: number }>();
  for (const m of matches) {
    const c = m.objective.champion;
    if (!c) continue;
    const e = byChamp.get(c) ?? { roles: new Map<Role, number>(), total: 0 };
    e.total++;
    const r = m.objective.role;
    if (r && r !== "UNKNOWN") e.roles.set(r, (e.roles.get(r) ?? 0) + 1);
    byChamp.set(c, e);
  }
  const manualByKey = new Map(manual.map((e) => [e.champion.toLowerCase(), e]));
  const out: ChampionPoolEntry[] = [];
  for (const [champion, e] of byChamp) {
    const man = manualByKey.get(champion.toLowerCase());
    if (e.total < MIN_GAMES && !man) continue; // not enough games and not hand-added
    const dominant = [...e.roles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const tier: PoolTier = man?.tier ?? (e.total >= 15 ? "main" : e.total >= 6 ? "secondary" : "lab");
    out.push({ champion, tier, roles: man?.roles ?? (dominant ? [dominant] : undefined) });
  }
  // Hand-added champions with no games yet still belong in the pool.
  for (const man of manual) {
    if (!byChamp.has(man.champion) && !out.some((o) => o.champion.toLowerCase() === man.champion.toLowerCase())) out.push(man);
  }
  return out.sort((a, b) => (b.tier === "main" ? 1 : 0) - (a.tier === "main" ? 1 : 0));
}
import { activeProfile } from "./activeProfile.ts";

export const DEFAULT_TUNING: Tuning = {
  verdictGood: 65,
  verdictBad: 45,
  benchmarks: {
    cs10: 70,
    gold15: 250,
    deaths15: 2,
    deaths: 5,
    kp: 55,
    objectives: 5,
    vision: 1.0,
    tilt: 70,
    flame: 100,
    process: 65,
    first_dead_fights: 30,
    deaths_before_objective: 0.5,
  },
};

// Documents are addressed by logical key now, not by path. Which backend those
// keys resolve to -- files under data/ on Node, D1 rows on Cloudflare -- is the
// adapter's business; see server/storage/contract.ts for why the read/write
// calls below stayed synchronous through the port.
const LIVE_KEY: DocKey = "live";
const DEMO_KEY: DocKey = "demo";
const PROFILE_KEY: DocKey = "profile";
const META_KEY: DocKey = "meta";
// Each viewed profile (a searched Riot ID) gets its own document with its own
// matches, blocks, and goals.
const profileDbCache = new Map<string, DB>();

interface DB {
  version: number;
  seasons: Season[];
  matches: Match[];
  goals: Goal[];
  notifications: NotificationItem[];
  settings: {
    activeSeasonId: string | null;
    sessionGapMinutes: number;
    lastLp: number | null;
    lastTier: string | null;
    lastDivision: string | null;
    rollingQuestState: Record<string, number>;
    tuning: Tuning;
    coachPlan: { plan: NextGamePlan; forGameCount: number; forQueue?: string; forMode?: string } | null;
    lastSyncAt: string | null;
    // "llm" = Claude-synthesized plan; "engine" = deterministic rules only ($0).
    // On a switch so you can compare the two side-by-side.
    coachMode?: "llm" | "engine";
    // Last-seen career state, so we only notify on *changes* (not on every
    // already-earned achievement). null = never baselined yet.
    notifSeen: { tiers: Record<string, number>; goals: string[]; level: number } | null;
    // Match ids known but not yet fetched — the persisted pull queue. Enumerated
    // once, then drained in batches so we don't re-scan the whole history each
    // sync (which blew the rate limit). Survives reloads so the pull resumes.
    pullPending?: string[];
    // Set once a full deep enumeration of this profile's history has completed.
    // After that, syncs only top-up incrementally (scan the newest games and
    // stop at the first already-stored one) instead of re-scanning everything —
    // which otherwise re-burned the rate limit and looped the pull banner.
    pullComplete?: boolean;
  };
}

interface Meta {
  demoMode: boolean;
}

const DEFAULT_PROFILE: Profile = {
  mainRole: null,
  primaryRole: null,
  secondaryRole: null,
  championPool: [],
  favorites: [],
  preferredRank: null,
  updatedAt: null,
};

const favKey = (g: string, t: string) => `${g}#${t}`.toLowerCase();

const DEFAULT_DB: DB = {
  version: 1,
  seasons: [],
  matches: [],
  goals: [],
  notifications: [],
  settings: {
    activeSeasonId: null,
    sessionGapMinutes: 180,
    lastLp: null,
    lastTier: null,
    lastDivision: null,
    rollingQuestState: {},
    tuning: DEFAULT_TUNING,
    coachPlan: null,
    lastSyncAt: null,
    notifSeen: null,
  },
};

const DEFAULT_META: Meta = {
  demoMode: false,
};

let liveCache: DB | null = null;
let demoCache: DB | null = null;
let profileCache: Profile | null = null;
let metaCache: Meta | null = null;

// These three were readFileSync / writeFileSync / existsSync. They are the
// entire storage surface of this file -- eleven call sites -- which is why the
// port did not have to touch the fifty methods below them.
function readJson<T>(key: DocKey): T | null {
  return docs().read<T>(key);
}

function persistJson(key: DocKey, data: unknown) {
  docs().write(key, data);
}

function docExists(key: DocKey): boolean {
  return docs().exists(key);
}

function hydrateDb(parsed: Partial<DB> | null): DB {
  return {
    ...structuredClone(DEFAULT_DB),
    ...parsed,
    settings: {
      ...DEFAULT_DB.settings,
      ...parsed?.settings,
      tuning: {
        ...DEFAULT_TUNING,
        ...parsed?.settings?.tuning,
        benchmarks: {
          ...DEFAULT_TUNING.benchmarks,
          ...parsed?.settings?.tuning?.benchmarks,
        },
      },
    },
  };
}

function loadMeta(): Meta {
  if (metaCache) return metaCache;
  metaCache = { ...DEFAULT_META, ...(readJson<Meta>(META_KEY) ?? {}) };
  persistJson(META_KEY, metaCache);
  return metaCache;
}

function persistMeta() {
  persistJson(META_KEY, metaCache ?? DEFAULT_META);
}

function loadProfile(): Profile {
  if (profileCache) return profileCache;
  const parsed = readJson<Profile>(PROFILE_KEY);
  if (parsed) {
    profileCache = { ...DEFAULT_PROFILE, ...parsed };
    return profileCache;
  }

  // One-time migration: if the legacy live DB had profile embedded, rescue it.
  const legacy = readJson<{ profile?: Profile }>(LIVE_KEY);
  profileCache = { ...DEFAULT_PROFILE, ...(legacy?.profile ?? {}) };
  persistJson(PROFILE_KEY, profileCache);
  return profileCache;
}

function persistProfile() {
  persistJson(PROFILE_KEY, profileCache ?? DEFAULT_PROFILE);
}

function loadDb(kind: "live" | "demo"): DB {
  const cache = kind === "live" ? liveCache : demoCache;
  if (cache) return cache;

  const key = kind === "live" ? LIVE_KEY : DEMO_KEY;
  const parsed = hydrateDb(readJson<DB & { profile?: Profile }>(key));
  if (kind === "live") liveCache = parsed;
  else demoCache = parsed;

  if (!docExists(key)) persistJson(key, parsed);
  return parsed;
}

function persistDb(kind: "live" | "demo") {
  const key = kind === "live" ? LIVE_KEY : DEMO_KEY;
  persistJson(key, kind === "live" ? liveCache ?? DEFAULT_DB : demoCache ?? DEFAULT_DB);
}

function profileFile(key: string): DocKey {
  return profileDocKey(key);
}

function loadProfileDb(key: string): DB {
  const cached = profileDbCache.get(key);
  if (cached) return cached;
  const parsed = hydrateDb(readJson<DB>(profileFile(key)));
  profileDbCache.set(key, parsed);
  if (!docExists(profileFile(key))) persistJson(profileFile(key), parsed);
  return parsed;
}

function persistProfileDb(key: string) {
  const db = profileDbCache.get(key);
  if (!db) return;
  persistJson(profileFile(key), db);
}

function currentKind(): "live" | "demo" {
  return loadMeta().demoMode ? "demo" : "live";
}

function currentDb(): DB {
  // Non-self profiles resolve to their own per-profile data file.
  const ap = activeProfile();
  if (!ap.isSelf && ap.key) return loadProfileDb(ap.key);

  const kind = currentKind();
  if (kind === "demo" && !docExists(DEMO_KEY)) {
    demoCache = seedDemoDb();
    persistDb("demo");
  }
  return loadDb(kind);
}

function saveCurrent() {
  const ap = activeProfile();
  if (!ap.isSelf && ap.key) {
    persistProfileDb(ap.key);
    return;
  }
  persistDb(currentKind());
}

function isoDaysAgo(days: number, hour = 19) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 10, 0, 0);
  return d.toISOString();
}

function baseScorecard(patch: Partial<Scorecard>): Scorecard {
  return {
    grade: "B",
    tiltBefore: 1,
    tiltAfter: 1,
    biggestMistake: "",
    firstDeathCause: null,
    bestDecision: "",
    oneAdjustment: "",
    doomedCollapse: false,
    flamed: false,
    mutedAppropriately: true,
    reviewed: true,
    ...patch,
  };
}

function baseObjective(patch: Partial<ObjectiveData>): ObjectiveData {
  return {
    role: "TOP",
    side: "BLUE",
    queue: "RANKED_SOLO_5x5",
    durationSec: 1800,
    kills: 4,
    deaths: 3,
    assists: 7,
    csAt10: 64,
    totalCs: 190,
    goldDiffAt15: 50,
    deathsBefore10: 1,
    deathsBefore15: 2,
    firstDeathSec: 420,
    killParticipation: 0.54,
    visionScore: 23,
    dragons: 2,
    voidgrubs: 2,
    heralds: 1,
    barons: 0,
    towers: 6,
    ...patch,
  };
}

function seedDemoDb(): DB {
  const prevSeasonId = globalThis.crypto.randomUUID();
  const activeSeasonId = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();

  const seasons: Season[] = [
    {
      id: prevSeasonId,
      name: "Patch 14.13: Stop Donating Lane",
      theme: "Play the first 12 minutes like they matter.",
      goal: "Stop losing the game before first Herald.",
      identityId: "stonewall",
      targetGames: 20,
      startedAt: isoDaysAgo(26),
      endedAt: isoDaysAgo(12),
      status: "complete",
      retro: {
        writtenAt: isoDaysAgo(12),
        whatWorked: "Reviewing losses caught the same recall greed pattern fast.",
        whatBroke: "Still over-trading waves I could have let bounce.",
        keepDoing: "Respect jungle timings and mute early.",
        stopDoing: "Blindly contesting every top crab fight.",
        nextBlockFocus: "Turn stable lanes into actual leads instead of just surviving.",
      },
    },
    {
      id: activeSeasonId,
      name: "Patch 14.14: Convert the Stable Lane",
      theme: "Stable lanes are only good if they cash out into gold and objectives.",
      goal: "Keep the lane floor while actually building advantages on my comfort picks.",
      identityId: "lane_bully",
      targetGames: 30,
      startedAt: isoDaysAgo(11),
      endedAt: null,
      status: "active",
      retro: null,
    },
  ];

  const demos: Array<{
    seasonId: string;
    playedAt: string;
    objective: ObjectiveData;
    scorecard: Scorecard;
  }> = [
    {
      seasonId: prevSeasonId,
      playedAt: isoDaysAgo(25),
      objective: baseObjective({
        champion: "Malphite",
        opponentChampion: "Renekton",
        win: false,
        lpDelta: -21,
        csAt10: 51,
        goldDiffAt15: -620,
        deaths: 6,
        deathsBefore15: 3,
        firstDeathSec: 240,
      }),
      scorecard: baseScorecard({
        grade: "D",
        tiltAfter: 4,
        firstDeathCause: "overextension",
        biggestMistake: "Forced a bad trade on stacked wave.",
        oneAdjustment: "Give up the wave and wait for bounce.",
      }),
    },
    {
      seasonId: prevSeasonId,
      playedAt: isoDaysAgo(23),
      objective: baseObjective({
        champion: "Ornn",
        opponentChampion: "Aatrox",
        win: true,
        lpDelta: 24,
        csAt10: 61,
        goldDiffAt15: -80,
        deaths: 2,
        deathsBefore15: 1,
        firstDeathSec: 690,
      }),
      scorecard: baseScorecard({
        grade: "B",
        bestDecision: "Held TP for dragon instead of ego fight.",
        oneAdjustment: "Use windows after base to drop deeper wards.",
      }),
    },
    {
      seasonId: prevSeasonId,
      playedAt: isoDaysAgo(21),
      objective: baseObjective({
        champion: "Garen",
        opponentChampion: "Darius",
        win: false,
        lpDelta: -20,
        csAt10: 57,
        goldDiffAt15: -430,
        deaths: 5,
        deathsBefore15: 3,
        firstDeathSec: 300,
      }),
      scorecard: baseScorecard({
        grade: "C",
        tiltAfter: 3,
        firstDeathCause: "laning_mistake",
        biggestMistake: "Took a short trade with his cooldowns up.",
        oneAdjustment: "Track his ghost and only trade with wave advantage.",
      }),
    },
    {
      seasonId: prevSeasonId,
      playedAt: isoDaysAgo(18),
      objective: baseObjective({
        champion: "Ornn",
        opponentChampion: "Jax",
        win: true,
        lpDelta: 23,
        csAt10: 66,
        goldDiffAt15: 130,
        deaths: 2,
        deathsBefore15: 1,
        firstDeathSec: 840,
      }),
      scorecard: baseScorecard({
        grade: "A",
        bestDecision: "Synced reset before second drake.",
        oneAdjustment: "Push harder when teleport advantage is up.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(10),
      objective: baseObjective({
        champion: "Malphite",
        opponentChampion: "Camille",
        win: true,
        lpDelta: 22,
        csAt10: 68,
        goldDiffAt15: 220,
        deaths: 2,
        deathsBefore15: 1,
        firstDeathSec: 780,
        dragons: 3,
      }),
      scorecard: baseScorecard({
        grade: "A",
        bestDecision: "Gave wave to keep health and won the next objective fight.",
        oneAdjustment: "Hold ult for carry flash next time.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(9),
      objective: baseObjective({
        champion: "Garen",
        opponentChampion: "K'Sante",
        win: false,
        lpDelta: -19,
        csAt10: 59,
        goldDiffAt15: -140,
        deaths: 4,
        deathsBefore15: 2,
        firstDeathSec: 390,
      }),
      scorecard: baseScorecard({
        grade: "C",
        tiltAfter: 2,
        firstDeathCause: "greedy_recall",
        biggestMistake: "One more plate brain before reset.",
        oneAdjustment: "Base on tempo, not desire.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(8),
      objective: baseObjective({
        champion: "Malphite",
        opponentChampion: "Jayce",
        win: true,
        lpDelta: 24,
        csAt10: 63,
        goldDiffAt15: 80,
        deaths: 1,
        deathsBefore15: 0,
        firstDeathSec: 1260,
      }),
      scorecard: baseScorecard({
        grade: "B",
        bestDecision: "Muted after first spam ping and kept map reads clean.",
        oneAdjustment: "Crash wave earlier before roam timer.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(7),
      objective: baseObjective({
        champion: "Renekton",
        opponentChampion: "Sion",
        win: true,
        lpDelta: 23,
        csAt10: 74,
        totalCs: 215,
        goldDiffAt15: 510,
        deaths: 3,
        deathsBefore15: 1,
        firstDeathSec: 810,
        killParticipation: 0.62,
      }),
      scorecard: baseScorecard({
        grade: "A",
        bestDecision: "Pressed lead into Herald instead of another solo dive.",
        oneAdjustment: "Convert the second crash into deeper vision.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(5),
      objective: baseObjective({
        champion: "Malphite",
        opponentChampion: "Fiora",
        win: false,
        lpDelta: -20,
        csAt10: 54,
        goldDiffAt15: -510,
        deaths: 5,
        deathsBefore15: 3,
        firstDeathSec: 270,
      }),
      scorecard: baseScorecard({
        grade: "D",
        tiltAfter: 4,
        firstDeathCause: "mechanical_misplay",
        biggestMistake: "Burned cooldowns before her riposte.",
        oneAdjustment: "Play for wave and jungle, not lane fantasy.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(4),
      objective: baseObjective({
        champion: "Ornn",
        opponentChampion: "Rumble",
        win: true,
        lpDelta: 21,
        csAt10: 65,
        goldDiffAt15: 120,
        deaths: 2,
        deathsBefore15: 1,
        firstDeathSec: 780,
      }),
      scorecard: baseScorecard({
        grade: "B",
        bestDecision: "Reset for dragon 45 seconds early.",
        oneAdjustment: "Trim wave sooner when his heat is low.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(3),
      objective: baseObjective({
        champion: "Renekton",
        opponentChampion: "Aatrox",
        win: true,
        lpDelta: 24,
        csAt10: 77,
        totalCs: 223,
        goldDiffAt15: 640,
        deaths: 2,
        deathsBefore15: 1,
        firstDeathSec: 960,
        killParticipation: 0.65,
      }),
      scorecard: baseScorecard({
        grade: "A",
        bestDecision: "Called off a bad Baron flip and took soul point setup instead.",
        oneAdjustment: "Use prio to invade earlier.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(2),
      objective: baseObjective({
        champion: "Malphite",
        opponentChampion: "Yone",
        win: false,
        lpDelta: -21,
        csAt10: 58,
        goldDiffAt15: -260,
        deaths: 4,
        deathsBefore15: 2,
        firstDeathSec: 360,
      }),
      scorecard: baseScorecard({
        grade: "C",
        tiltAfter: 2,
        firstDeathCause: "objective_setup",
        biggestMistake: "Walked into river late with no vision.",
        oneAdjustment: "Base earlier for objective setup.",
      }),
    },
    {
      seasonId: activeSeasonId,
      playedAt: isoDaysAgo(1),
      objective: baseObjective({
        champion: "Renekton",
        opponentChampion: "Gragas",
        win: true,
        lpDelta: 25,
        csAt10: 72,
        totalCs: 210,
        goldDiffAt15: 470,
        deaths: 2,
        deathsBefore15: 1,
        firstDeathSec: 870,
      }),
      scorecard: baseScorecard({
        grade: "A",
        bestDecision: "Turned lane lead into first two grubs and Herald.",
        oneAdjustment: "Ping roam timing sooner for mid.",
      }),
    },
  ];

  const matches: Match[] = demos.map((d, i) => ({
    id: globalThis.crypto.randomUUID(),
    seasonId: d.seasonId,
    playedAt: d.playedAt,
    loggedAt: d.playedAt,
    source: "manual",
    objective: d.objective,
    scorecard: d.scorecard,
  }));

  const goals: Goal[] = [
    {
      id: globalThis.crypto.randomUUID(),
      seasonId: activeSeasonId,
      templateId: "gold_diff_15",
      title: "Gold lead at 15",
      description: "Average +250 gold vs your opponent by 15.",
      category: "aggression",
      target: 250,
      unit: "gold@15",
      direction: "higher",
      champion: null,
      createdAt: now,
      status: "active",
    },
    {
      id: globalThis.crypto.randomUUID(),
      seasonId: activeSeasonId,
      templateId: "deaths_before_15",
      title: "Deaths before 15",
      description: "No more than 2 deaths before 15 minutes, on average.",
      category: "survival",
      target: 2,
      unit: "deaths <15",
      direction: "lower",
      champion: null,
      createdAt: now,
      status: "active",
    },
    {
      id: globalThis.crypto.randomUUID(),
      seasonId: activeSeasonId,
      templateId: "champion_focus",
      title: "Commit to Renekton",
      description: "Play Renekton at least 10 games this block.",
      category: "champion",
      target: 10,
      unit: "games",
      direction: "higher",
      champion: "Renekton",
      createdAt: now,
      status: "active",
    },
  ];

  return {
    version: 1,
    seasons,
    matches,
    goals,
    notifications: [],
    settings: {
      activeSeasonId,
      sessionGapMinutes: 180,
      lastLp: 76,
      lastTier: "PLATINUM",
      lastDivision: "IV",
      rollingQuestState: {},
      tuning: DEFAULT_TUNING,
      coachPlan: null,
      lastSyncAt: null,
      notifSeen: null,
    },
  };
}

export const store = {
  raw: () => currentDb(),

  seasons: () => currentDb().seasons,
  // Data views see the active season span (set per-request); "all-time" opens
  // the full history. Ingest/backfill use allMatches() to bypass the filter.
  matches: () => {
    const cutoff = activeProfile().spanCutoff;
    const all = currentDb().matches;
    if (cutoff == null) return all;
    return all.filter((m) => {
      const t = m.playedAt ? Date.parse(m.playedAt) : NaN;
      return isNaN(t) || t >= cutoff; // keep undatable games rather than drop them
    });
  },
  allMatches: () => currentDb().matches,
  settings: () => currentDb().settings,

  demoState() {
    const meta = loadMeta();
    return { enabled: meta.demoMode, available: docExists(DEMO_KEY) };
  },

  setDemoMode(enabled: boolean) {
    const meta = loadMeta();
    meta.demoMode = enabled;
    metaCache = meta;
    if (enabled && !docExists(DEMO_KEY)) {
      demoCache = seedDemoDb();
      persistDb("demo");
    }
    persistMeta();
  },

  resetDemo() {
    demoCache = seedDemoDb();
    persistDb("demo");
  },

  activeSeason(): Season | null {
    const db = currentDb();
    return db.seasons.find((s) => s.id === db.settings.activeSeasonId) ?? null;
  },

  getSeason(id: string): Season | undefined {
    return currentDb().seasons.find((s) => s.id === id);
  },

  addSeason(season: Season) {
    const db = currentDb();
    db.seasons.push(season);
    db.settings.activeSeasonId = season.id;
    saveCurrent();
  },

  updateSeason(id: string, patch: Partial<Season>) {
    const db = currentDb();
    const i = db.seasons.findIndex((s) => s.id === id);
    if (i === -1) return;
    db.seasons[i] = { ...db.seasons[i], ...patch };
    saveCurrent();
  },

  setActiveSeason(id: string | null) {
    const db = currentDb();
    db.settings.activeSeasonId = id;
    saveCurrent();
  },

  matchesForSeason(seasonId: string): Match[] {
    return currentDb().matches.filter((m) => m.seasonId === seasonId);
  },

  hasRiotMatch(riotMatchId: string): boolean {
    return currentDb().matches.some((m) => m.objective.riotMatchId === riotMatchId);
  },

  addMatch(match: Match) {
    // Idempotent on the Riot match id: a single sync can surface the same game
    // from two queue buckets, and a manual + auto sync can race. Never store the
    // same Riot game twice.
    const rid = match.objective.riotMatchId;
    const db = currentDb();
    if (rid && db.matches.some((m) => m.objective.riotMatchId === rid)) return;
    db.matches.push(match);
    saveCurrent();
  },

  updateMatch(id: string, patch: Partial<Match>) {
    const db = currentDb();
    const i = db.matches.findIndex((m) => m.id === id);
    if (i === -1) return;
    db.matches[i] = { ...db.matches[i], ...patch };
    saveCurrent();
  },

  deleteMatch(id: string) {
    const db = currentDb();
    db.matches = db.matches.filter((m) => m.id !== id);
    saveCurrent();
  },

  updateSettings(patch: Partial<DB["settings"]>) {
    const db = currentDb();
    db.settings = { ...db.settings, ...patch };
    saveCurrent();
  },

  isDemo(): boolean {
    // Demo mode only applies to your own profile; searched profiles use live data.
    return activeProfile().isSelf && loadMeta().demoMode;
  },

  // The champion pool is your personal curation — searched profiles don't have one.
  activePool(): ChampionPoolEntry[] {
    // Per-profile: derived from that profile's games, merged with the self
    // profile's hand-added entries (scouted profiles have no manual list).
    const manual = activeProfile().isSelf ? loadProfile().championPool : [];
    return derivePool(currentDb().matches, manual);
  },

  lastSyncAt(): string | null {
    return currentDb().settings.lastSyncAt;
  },

  setLastSyncAt(iso: string) {
    currentDb().settings.lastSyncAt = iso;
    saveCurrent();
  },

  pullPending(): string[] {
    return currentDb().settings.pullPending ?? [];
  },
  setPullPending(ids: string[]) {
    currentDb().settings.pullPending = ids;
    saveCurrent();
  },

  pullComplete(): boolean {
    return currentDb().settings.pullComplete ?? false;
  },
  setPullComplete(done: boolean) {
    currentDb().settings.pullComplete = done;
    saveCurrent();
  },

  coachPlan(): { plan: NextGamePlan; forGameCount: number; forQueue?: string; forMode?: string } | null {
    return currentDb().settings.coachPlan;
  },

  setCoachPlan(plan: NextGamePlan, forGameCount: number, forQueue = "all", forMode = "llm") {
    const db = currentDb();
    db.settings.coachPlan = { plan, forGameCount, forQueue, forMode };
    saveCurrent();
  },

  coachMode(): "llm" | "engine" {
    return currentDb().settings.coachMode ?? "llm";
  },
  setCoachMode(mode: "llm" | "engine") {
    currentDb().settings.coachMode = mode;
    saveCurrent();
  },

  // --- Notifications ---
  notifications(): NotificationItem[] {
    return currentDb().notifications;
  },
  notifSeen() {
    return currentDb().settings.notifSeen;
  },
  setNotifSeen(seen: { tiers: Record<string, number>; goals: string[]; level: number }) {
    currentDb().settings.notifSeen = seen;
    saveCurrent();
  },
  pushNotifications(items: NotificationItem[]) {
    if (!items.length) return;
    const db = currentDb();
    // Newest first; keep the list bounded so the file doesn't grow forever.
    db.notifications = [...items, ...db.notifications].slice(0, 60);
    saveCurrent();
  },
  markNotificationsRead() {
    const db = currentDb();
    let changed = false;
    for (const n of db.notifications) if (!n.read) { n.read = true; changed = true; }
    if (changed) saveCurrent();
  },
  clearNotifications() {
    // Clears the visible stack but keeps the seen-state, so cleared items don't
    // re-fire on the next diff.
    currentDb().notifications = [];
    saveCurrent();
  },

  claimRollingQuest(familyKey: string) {
    const db = currentDb();
    db.settings.rollingQuestState = {
      ...db.settings.rollingQuestState,
      [familyKey]: (db.settings.rollingQuestState[familyKey] ?? 0) + 1,
    };
    saveCurrent();
  },

  profile(): Profile {
    return loadProfile();
  },

  favorites(): FavoriteProfile[] {
    return loadProfile().favorites ?? [];
  },

  addFavorite(f: FavoriteProfile) {
    const p = loadProfile();
    const favs = p.favorites ?? [];
    if (!favs.some((x) => favKey(x.gameName, x.tagLine) === favKey(f.gameName, f.tagLine))) {
      profileCache = { ...p, favorites: [...favs, f] };
      persistProfile();
    }
  },

  removeFavorite(gameName: string, tagLine: string) {
    const p = loadProfile();
    profileCache = {
      ...p,
      favorites: (p.favorites ?? []).filter((x) => favKey(x.gameName, x.tagLine) !== favKey(gameName, tagLine)),
    };
    persistProfile();
  },

  updateProfile(patch: Partial<Profile>) {
    const profile = loadProfile();
    profileCache = {
      ...profile,
      ...patch,
      championPool: patch.championPool ?? profile.championPool,
      updatedAt: new Date().toISOString(),
    };
    persistProfile();
  },

  goals(): Goal[] {
    return currentDb().goals;
  },

  goalsForSeason(seasonId: string): Goal[] {
    return currentDb().goals.filter(
      (g) => g.seasonId === seasonId && g.status !== "archived"
    );
  },

  addGoal(goal: Goal) {
    currentDb().goals.push(goal);
    saveCurrent();
  },

  updateGoal(id: string, patch: Partial<Goal>) {
    const db = currentDb();
    const i = db.goals.findIndex((g) => g.id === id);
    if (i === -1) return;
    db.goals[i] = { ...db.goals[i], ...patch };
    saveCurrent();
  },

  deleteGoal(id: string) {
    const db = currentDb();
    db.goals = db.goals.filter((g) => g.id !== id);
    saveCurrent();
  },

  tuning(): Tuning {
    return currentDb().settings.tuning;
  },

  updateTuning(patch: Partial<Tuning> & { benchmarks?: Record<string, number> }) {
    const db = currentDb();
    db.settings.tuning = {
      ...db.settings.tuning,
      ...patch,
      benchmarks: { ...db.settings.tuning.benchmarks, ...(patch.benchmarks ?? {}) },
    };
    saveCurrent();
  },

  exportAll(): DB {
    return currentDb();
  },

  importAll(incoming: Partial<DB> & { profile?: Profile }) {
    const merged: DB = {
      ...structuredClone(DEFAULT_DB),
      ...incoming,
      settings: {
        ...DEFAULT_DB.settings,
        ...incoming.settings,
        tuning: {
          ...DEFAULT_TUNING,
          ...incoming.settings?.tuning,
          benchmarks: {
            ...DEFAULT_TUNING.benchmarks,
            ...incoming.settings?.tuning?.benchmarks,
          },
        },
      },
    };
    if (currentKind() === "live") liveCache = merged;
    else demoCache = merged;
    saveCurrent();
    if (incoming.profile) {
      profileCache = { ...DEFAULT_PROFILE, ...incoming.profile };
      persistProfile();
    }
  },

  cloneSeason(id: string, name: string): Season | null {
    const src = this.getSeason(id);
    if (!src) return null;
    const clone: Season = {
      id: globalThis.crypto.randomUUID(),
      name,
      theme: src.theme,
      goal: src.goal,
      identityId: src.identityId,
      targetGames: src.targetGames,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "active",
      retro: null,
    };
    this.addSeason(clone);
    for (const g of this.goalsForSeason(id)) {
      this.addGoal({
        ...g,
        id: globalThis.crypto.randomUUID(),
        seasonId: clone.id,
        status: "active",
        createdAt: new Date().toISOString(),
      });
    }
    return clone;
  },
};
