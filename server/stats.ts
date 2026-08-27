import type { EnrichedMatch, StatsResponse, StatDomain, StatTile, StatLadderPoint, Role } from "../shared/types.ts";
import { store } from "./store.ts";
import { enrichAll } from "./engine/enrich.ts";
import { activeProfile } from "./activeProfile.ts";
import { RANK_KEYS, RANK_BENCH, benchFor, rankLabel, type RankKey, type RankBench } from "./engine/benchmarks.ts";

// ---------------------------------------------------------------------------
// STATS PAGE (DPM-Lens-style)
//
// Rolls the player's games up into domain score cards (Fighting, Laning, Vision,
// …), each 0-100 vs a rank benchmark, with per-stat tiles and — where we have
// cohort data (the rank bench) — an Iron→Challenger ladder with your value
// marked. Sliceable by queue and role.
// ---------------------------------------------------------------------------

const def = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const mins = (m: EnrichedMatch) => (m.objective.durationSec ? m.objective.durationSec / 60 : null);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

interface StatDef {
  key: string;
  label: string;
  unit: string;
  direction: "higher" | "lower";
  benchKey?: keyof RankBench; // has a rank ladder
  ref?: number; // fixed reference when no ladder
  pick: (m: EnrichedMatch) => number | null;
  // Ratio stats (win rates, damage shares) aggregate by summed totals across the
  // window, not by averaging each game's rate — one duel shouldn't read as 0/100%.
  rate?: { num: (m: EnrichedMatch) => number | null; den: (m: EnrichedMatch) => number | null };
  hint: string;
}

const kdaOf = (m: EnrichedMatch) => {
  const { kills, deaths, assists } = m.objective;
  return kills != null && deaths != null && assists != null ? (kills + assists) / Math.max(1, deaths) : null;
};
const objsOf = (m: EnrichedMatch) => {
  const o = m.objective;
  if (o.dragons == null && o.heralds == null && o.barons == null) return null;
  return (o.dragons ?? 0) + (o.heralds ?? 0) + (o.barons ?? 0);
};
const adv = (m: EnrichedMatch) => m.objective.adv;
const advNum = (m: EnrichedMatch, k: keyof NonNullable<EnrichedMatch["objective"]["adv"]>) => {
  const v = adv(m)?.[k];
  return v == null ? null : (v as number);
};
const multikillsOf = (m: EnrichedMatch) => {
  const a = adv(m);
  if (!a || (a.doubleKills == null && a.tripleKills == null && a.quadraKills == null && a.pentaKills == null)) return null;
  return (a.doubleKills ?? 0) + (a.tripleKills ?? 0) + (a.quadraKills ?? 0) + (a.pentaKills ?? 0);
};
const phaseTotal = (m: EnrichedMatch) => {
  const a = adv(m);
  if (!a || a.dmgEarly == null) return null;
  return (a.dmgEarly ?? 0) + (a.dmgMid ?? 0) + (a.dmgLate ?? 0);
};

const STATS: Record<string, StatDef> = {
  kda: { key: "kda", label: "KDA", unit: "", direction: "higher", benchKey: "kda", pick: kdaOf, hint: "(Kills + Assists) ÷ Deaths, averaged." },
  kp: { key: "kp", label: "Kill participation", unit: "%", direction: "higher", benchKey: "kp", pick: (m) => (m.objective.killParticipation != null ? m.objective.killParticipation * 100 : null), hint: "Your share of the team's kills (K+A ÷ team kills)." },
  solo: { key: "solo", label: "Solo kills", unit: "", direction: "higher", benchKey: "solo", pick: (m) => m.objective.soloKills ?? null, hint: "Kills you get with no ally assisting." },
  dmgMin: { key: "dmgMin", label: "Damage / min", unit: "", direction: "higher", ref: 620, pick: (m) => { const mm = mins(m); return m.objective.damageToChampions != null && mm ? m.objective.damageToChampions / mm : null; }, hint: "Champion damage per minute." },
  dmgShare: { key: "dmgShare", label: "Damage share", unit: "%", direction: "higher", ref: 22, pick: (m) => (m.objective.teamDamageShare != null ? m.objective.teamDamageShare * 100 : null), hint: "Your champion damage as a share of your team's." },
  cs10: { key: "cs10", label: "CS @ 10", unit: "", direction: "higher", benchKey: "cs10", pick: (m) => m.objective.csAt10 ?? null, hint: "Creep score at the 10-minute mark." },
  csMin: { key: "csMin", label: "CS / min", unit: "", direction: "higher", ref: 6.5, pick: (m) => { const mm = mins(m); return m.objective.totalCs != null && mm ? m.objective.totalCs / mm : null; }, hint: "Total CS ÷ minutes played." },
  gold15: { key: "gold15", label: "Gold @ 15", unit: "g", direction: "higher", benchKey: "gold15", pick: (m) => m.objective.goldDiffAt15 ?? null, hint: "Your gold minus your lane opponent's at 15." },
  vision: { key: "vision", label: "Vision / min", unit: "", direction: "higher", benchKey: "vision", pick: (m) => { const mm = mins(m); return m.objective.visionScore != null && mm ? m.objective.visionScore / mm : null; }, hint: "Vision score ÷ minutes played." },
  deaths15: { key: "deaths15", label: "Deaths before 15", unit: "", direction: "lower", benchKey: "deaths15", pick: (m) => m.objective.deathsBefore15 ?? null, hint: "Deaths you take before 15 minutes." },
  deathsGame: { key: "deathsGame", label: "Deaths / game", unit: "", direction: "lower", ref: 5, pick: (m) => m.objective.deaths ?? null, hint: "Total deaths per game." },
  firstDeath: { key: "firstDeath", label: "First death", unit: "s", direction: "higher", ref: 480, pick: (m) => m.objective.firstDeathSec ?? null, hint: "When your first death lands — later is better." },
  obj: { key: "obj", label: "Team objectives", unit: "", direction: "higher", benchKey: "obj", pick: objsOf, hint: "Dragons + heralds + barons your team secures." },

  // --- Deep tree (from the match `challenges` block + timeline) ---
  multi: { key: "multi", label: "Multi-kills", unit: "", direction: "higher", ref: 0.7, pick: multikillsOf, hint: "Double-kills and up, per game." },
  duelWR: { key: "duelWR", label: "Duel win rate", unit: "%", direction: "higher", ref: 50, pick: () => null, rate: { num: (m) => advNum(m, "duelWins"), den: (m) => advNum(m, "duels") }, hint: "1v1 fights your team came out ahead in." },
  skirmishWR: { key: "skirmishWR", label: "Skirmish win rate", unit: "%", direction: "higher", ref: 50, pick: () => null, rate: { num: (m) => advNum(m, "skirmishWins"), den: (m) => advNum(m, "skirmishes") }, hint: "Small fights (3–5 champs) your team won." },
  teamfightWR: { key: "teamfightWR", label: "Teamfight win rate", unit: "%", direction: "higher", ref: 50, pick: () => null, rate: { num: (m) => advNum(m, "teamfightWins"), den: (m) => advNum(m, "teamfights") }, hint: "Big fights (6+ champs) your team won." },
  plates: { key: "plates", label: "Turret plates", unit: "", direction: "higher", ref: 1.5, pick: (m) => advNum(m, "turretPlates"), hint: "Turret plating gold you take, per game." },
  ctrlWards: { key: "ctrlWards", label: "Control wards", unit: "", direction: "higher", ref: 3, pick: (m) => advNum(m, "controlWards"), hint: "Control/pink wards placed, per game." },
  wardsKilled: { key: "wardsKilled", label: "Wards cleared", unit: "", direction: "higher", ref: 3, pick: (m) => advNum(m, "wardsKilled"), hint: "Enemy wards you destroy, per game." },
  dragonTD: { key: "dragonTD", label: "Dragon takedowns", unit: "", direction: "higher", ref: 1.6, pick: (m) => advNum(m, "dragonTakedowns"), hint: "Dragons you help secure, per game." },
  baronTD: { key: "baronTD", label: "Baron takedowns", unit: "", direction: "higher", ref: 0.7, pick: (m) => advNum(m, "baronTakedowns"), hint: "Barons you help secure, per game." },
  grubTD: { key: "grubTD", label: "Void grub takedowns", unit: "", direction: "higher", ref: 3, pick: (m) => advNum(m, "grubTakedowns"), hint: "Void grubs you help secure, per game." },
  skillDodged: { key: "skillDodged", label: "Skillshots dodged", unit: "", direction: "higher", ref: 12, pick: (m) => advNum(m, "skillshotsDodged"), hint: "Enemy skillshots you sidestep, per game." },
  immob: { key: "immob", label: "Enemies CC'd", unit: "", direction: "higher", ref: 22, pick: (m) => advNum(m, "immobilizations"), hint: "Enemies you root/stun/knock, per game." },
  placement: { key: "placement", label: "Avg placement", unit: "", direction: "lower", ref: 4.5, pick: (m) => m.objective.placement ?? null, hint: "Where you finish (1 = won the lobby)." },
  dmgEarlyShare: { key: "dmgEarlyShare", label: "Early damage", unit: "%", direction: "higher", ref: 33, pick: () => null, rate: { num: (m) => advNum(m, "dmgEarly"), den: phaseTotal }, hint: "Share of your champ damage dealt before 14 min." },
  dmgMidShare: { key: "dmgMidShare", label: "Mid damage", unit: "%", direction: "higher", ref: 34, pick: () => null, rate: { num: (m) => advNum(m, "dmgMid"), den: phaseTotal }, hint: "Share of your champ damage dealt from 14–25 min." },
  dmgLateShare: { key: "dmgLateShare", label: "Late damage", unit: "%", direction: "higher", ref: 33, pick: () => null, rate: { num: (m) => advNum(m, "dmgLate"), den: phaseTotal }, hint: "Share of your champ damage dealt after 25 min." },
};

const DOMAINS: { key: string; label: string; icon: string; stats: string[]; scored?: boolean }[] = [
  { key: "fighting", label: "Fighting", icon: "ti-swords", stats: ["kda", "kp", "solo", "dmgMin", "multi"] },
  { key: "teamfights", label: "Teamfighting", icon: "ti-users-group", stats: ["duelWR", "skirmishWR", "teamfightWR"] },
  { key: "laning", label: "Laning", icon: "ti-map-pin", stats: ["cs10", "csMin", "gold15", "plates"] },
  { key: "vision", label: "Vision", icon: "ti-eye", stats: ["vision", "ctrlWards", "wardsKilled"] },
  { key: "survival", label: "Survivability", icon: "ti-shield-half", stats: ["deaths15", "deathsGame", "firstDeath"] },
  { key: "mechanics", label: "Mechanics", icon: "ti-target-arrow", stats: ["skillDodged", "immob"] },
  { key: "objectives", label: "Objectives", icon: "ti-topology-star-3", stats: ["obj", "dragonTD", "baronTD", "grubTD"] },
  { key: "teamImpact", label: "Team Impact", icon: "ti-users", stats: ["kp", "dmgShare"] },
  { key: "arena", label: "Arena", icon: "ti-trophy", stats: ["placement"] },
  // Descriptive: a profile of *when* your damage lands, not a grade — excluded
  // from the composite and never flagged as your weakest area.
  { key: "timing", label: "Damage timing", icon: "ti-clock-hour-4", stats: ["dmgEarlyShare", "dmgMidShare", "dmgLateShare"], scored: false },
];

const ARAM_STATS = new Set([
  "kda", "kp", "dmgMin", "dmgShare", "csMin", "deathsGame",
  "multi", "duelWR", "skirmishWR", "teamfightWR", "skillDodged", "immob",
  "dmgEarlyShare", "dmgMidShare", "dmgLateShare",
]);
const ARENA_STATS = new Set(["placement", "kda", "dmgMin", "multi", "deathsGame", "skillDodged", "immob"]);

function avg(ms: EnrichedMatch[], pick: (m: EnrichedMatch) => number | null): number | null {
  const v = ms.map(pick).filter(def);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// 0-100 position vs the benchmark (50 = at benchmark; >50 better).
function pctVs(value: number, benchmark: number, direction: "higher" | "lower"): number {
  const mag = Math.max(1, Math.abs(benchmark));
  const imp = direction === "higher" ? value - benchmark : benchmark - value;
  return Math.max(4, Math.min(100, Math.round(50 + (imp / mag) * 50)));
}

function ladderFor(benchKey: keyof RankBench, value: number | null, direction: "higher" | "lower"): StatLadderPoint[] {
  const pts: StatLadderPoint[] = RANK_KEYS.map((rk: RankKey) => ({ rank: rankLabel(rk), value: round(RANK_BENCH[rk][benchKey]) }));
  if (value != null) {
    // Insert your marker where your value falls on the ladder.
    let idx = pts.length; // default: past the top
    for (let i = 0; i < pts.length; i++) {
      const beats = direction === "higher" ? value < pts[i].value : value > pts[i].value;
      if (beats) { idx = i; break; }
    }
    pts.splice(idx, 0, { rank: "You", value: round(value), isYou: true });
  }
  return pts;
}

// Tokens that mark a game as NOT standard Summoner's Rift, so the default "sr"
// board doesn't fold ARAM/Arena/rotating modes into your Rift skill scores.
const NON_SR = ["ARAM", "ARENA", "URF", "MAYHEM", "NEXUS", "ONE_FOR_ALL"];
const QUEUE_MATCH: Record<string, (q: string) => boolean> = {
  ranked_solo: (q) => q.includes("RANKED_SOLO"),
  ranked_flex: (q) => q.includes("RANKED_FLEX"),
  swiftplay: (q) => q.includes("SWIFTPLAY") || q.includes("QUICKPLAY"),
  draft: (q) => q.includes("DRAFT") || q.includes("BLIND"),
  aram: (q) => q.includes("ARAM") && !q.includes("MAYHEM"),
  arena: (q) => q.includes("ARENA"),
  sr: (q) => !NON_SR.some((t) => q.includes(t)),
};

export function buildStats(queue: string, role: string | null): StatsResponse {
  const ap = activeProfile();
  const pool = store.activePool();
  const career = enrichAll(store.matches(), store.seasons(), pool);

  const isAram = queue === "aram";
  const isArena = queue === "arena";
  const laddered = !isAram && !isArena; // only Rift queues have a rank-cohort ladder
  const match = QUEUE_MATCH[queue] ?? QUEUE_MATCH.sr;
  const inQueue = (m: EnrichedMatch) => match((m.objective.queue ?? "").toUpperCase());
  let games = career.filter(inQueue);
  const roles = [...new Set(games.map((m) => m.objective.role).filter((r): r is Role => !!r && r !== "UNKNOWN"))];
  if (role) games = games.filter((m) => m.objective.role === role);

  const empty: StatsResponse = { found: false, composite: 0, rank: "", games: 0, queue, role, roles, domains: [] };
  if (games.length === 0) return empty;

  const { rank, bench } = benchFor(ap.isSelf ? store.profile().preferredRank : null, games.slice(-1)[0]?.objective.tier);
  const rankName = isArena ? "Arena avg" : isAram ? "ARAM avg" : rankLabel(rank);

  const buildTile = (statKey: string): StatTile | null => {
    const s = STATS[statKey];
    if (!s) return null;
    if (isAram && !ARAM_STATS.has(statKey)) return null; // ARAM has no lanes/vision/objectives
    if (isArena && !ARENA_STATS.has(statKey)) return null; // Arena is a different game
    if (!isArena && statKey === "placement") return null; // placement is an Arena-only outcome

    // Ratio stats sum their numerator/denominator across the window; the rest
    // average the per-game value.
    let value: number | null;
    if (s.rate) {
      let num = 0, den = 0;
      for (const m of games) {
        const n = s.rate.num(m), d = s.rate.den(m);
        if (n != null && d != null && d > 0) { num += n; den += d; }
      }
      value = den > 0 ? (num / den) * 100 : null;
    } else {
      value = avg(games, s.pick);
    }

    // Benchmark: rank cohort for laddered stats on Rift, else the fixed ref.
    const useLadder = laddered && !!s.benchKey;
    const benchmark = useLadder ? bench[s.benchKey!] : s.ref ?? (s.benchKey ? bench[s.benchKey] : 50);
    const better = value != null && (s.direction === "higher" ? value >= benchmark : value <= benchmark);
    const pct = value != null ? pctVs(value, benchmark, s.direction) : 50;
    const ladder = useLadder ? ladderFor(s.benchKey!, value != null ? round(value) : null, s.direction) : null;
    return {
      key: s.key, label: s.label, value: value != null ? round(value) : null, unit: s.unit,
      benchmark: round(benchmark), direction: s.direction, better, pct, ladder, hint: s.hint,
    };
  };

  const descriptive = new Set(DOMAINS.filter((d) => d.scored === false).map((d) => d.key));
  const domains: StatDomain[] = DOMAINS
    .map((d) => {
      // Keep every stat in the domain visible (missing ones show "—"); only
      // score from the ones that have data.
      const tiles = d.stats.map(buildTile).filter((t): t is StatTile => t !== null);
      const scored = tiles.filter((t) => t.value != null);
      // Hide a domain with no data at all (e.g. the deep-tree domains before a
      // sync back-fills them); a partially-filled one still shows its "—" tiles.
      if (scored.length === 0) return null;
      const score = Math.round(scored.reduce((a, t) => a + t.pct, 0) / scored.length);
      return { key: d.key, label: d.label, icon: d.icon, score, weakest: false, tiles };
    })
    .filter((d): d is StatDomain => d !== null);

  // Weakest + composite only consider *graded* domains that actually have data
  // (descriptive domains like Damage timing are a profile, not a score).
  const scoredDomains = domains.filter((d) => !descriptive.has(d.key) && d.tiles.some((t) => t.value != null));
  if (scoredDomains.length) {
    scoredDomains.reduce((a, b) => (b.score < a.score ? b : a)).weakest = true;
  }
  const composite = scoredDomains.length
    ? Math.round(scoredDomains.reduce((a, d) => a + d.score, 0) / scoredDomains.length)
    : 0;

  return { found: true, composite, rank: rankName, games: games.length, queue, role, roles, domains };
}
