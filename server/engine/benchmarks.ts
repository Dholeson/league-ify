import type { StatComparison } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// RANK BENCHMARKS
//
// Approximate solo-queue averages per rank for the stats we compare a player's
// champion performance against. Not exact ladder data — a sensible, monotonic
// reference so "vs Gold average" means something. The compared-against rank is
// a setting (profile.preferredRank); default is the player's own tier.
// ---------------------------------------------------------------------------

export type RankKey =
  | "IRON" | "BRONZE" | "SILVER" | "GOLD" | "PLATINUM"
  | "EMERALD" | "DIAMOND" | "MASTER" | "GRANDMASTER" | "CHALLENGER";

export interface RankBench {
  cs10: number;
  deaths15: number; // lower is better
  gold15: number;
  kp: number; // %
  vision: number; // per min
  kda: number;
  solo: number; // solo kills / game
  obj: number; // team objectives / game
}

export const RANK_KEYS: RankKey[] = [
  "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM",
  "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER",
];

// index 0..9 → Iron..Challenger. Values interpolate smoothly across the ladder.
export const RANK_BENCH: Record<RankKey, RankBench> = {
  IRON:        { cs10: 42, deaths15: 3.2, gold15: -400, kp: 44, vision: 0.6, kda: 1.7, solo: 0.4, obj: 3.2 },
  BRONZE:      { cs10: 47, deaths15: 3.0, gold15: -280, kp: 46, vision: 0.65, kda: 1.9, solo: 0.5, obj: 3.6 },
  SILVER:      { cs10: 52, deaths15: 2.7, gold15: -160, kp: 48, vision: 0.72, kda: 2.1, solo: 0.6, obj: 4.0 },
  GOLD:        { cs10: 58, deaths15: 2.4, gold15: -40, kp: 51, vision: 0.82, kda: 2.3, solo: 0.8, obj: 4.4 },
  PLATINUM:    { cs10: 63, deaths15: 2.1, gold15: 60, kp: 53, vision: 0.92, kda: 2.5, solo: 1.0, obj: 4.8 },
  EMERALD:     { cs10: 67, deaths15: 1.9, gold15: 140, kp: 55, vision: 1.02, kda: 2.7, solo: 1.15, obj: 5.1 },
  DIAMOND:     { cs10: 71, deaths15: 1.7, gold15: 240, kp: 57, vision: 1.15, kda: 2.9, solo: 1.35, obj: 5.4 },
  MASTER:      { cs10: 75, deaths15: 1.5, gold15: 350, kp: 58, vision: 1.28, kda: 3.1, solo: 1.55, obj: 5.7 },
  GRANDMASTER: { cs10: 78, deaths15: 1.4, gold15: 430, kp: 59, vision: 1.4, kda: 3.3, solo: 1.7, obj: 5.9 },
  CHALLENGER:  { cs10: 81, deaths15: 1.3, gold15: 520, kp: 60, vision: 1.5, kda: 3.5, solo: 1.85, obj: 6.1 },
};

export function normalizeRank(rank?: string | null): RankKey | null {
  if (!rank) return null;
  const u = rank.toUpperCase();
  return (RANK_KEYS.find((k) => k === u) as RankKey) ?? null;
}

// Which rank to compare against: the explicit preference, else the player's own
// tier, else Gold.
export function benchFor(preferred?: string | null, ownTier?: string | null): { rank: RankKey; bench: RankBench } {
  const rank = normalizeRank(preferred) ?? normalizeRank(ownTier) ?? "GOLD";
  return { rank, bench: RANK_BENCH[rank] };
}

const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
export const rankLabel = (k: RankKey) => cap(k);

// One stat compared against a benchmark → a bar with a "better/worse" verdict.
export function compareStat(
  key: string, label: string, value: number | null, benchmark: number,
  unit: string, direction: "higher" | "lower"
): StatComparison {
  const better = value != null && (direction === "higher" ? value >= benchmark : value <= benchmark);
  let pct = 50;
  if (value != null) {
    const mag = Math.max(1, Math.abs(benchmark));
    const imp = direction === "higher" ? value - benchmark : benchmark - value;
    pct = Math.max(4, Math.min(100, Math.round(50 + (imp / mag) * 50)));
  }
  return { key, label, value, benchmark, unit, direction, better, pct };
}

// ARAM has no ranked ladder, so we compare against fixed "solid game" references
// rather than a rank bench. Damage share of 20% is exactly average (5 players).
const ARAM_REF = { kda: 2.6, kp: 62, dmgShare: 22, csmin: 4.6 };

// Compare a single game's stat line against the benchmark — the good/needs-work
// split on the match detail page.
export function matchComparison(
  o: import("../../shared/types.ts").ObjectiveData,
  bench: RankBench,
  isAram: boolean
): StatComparison[] {
  const durMin = o.durationSec ? o.durationSec / 60 : null;
  const kda =
    o.kills != null && o.deaths != null && o.assists != null
      ? Math.round(((o.kills + o.assists) / Math.max(1, o.deaths)) * 10) / 10
      : null;
  const kp = o.killParticipation != null ? Math.round(o.killParticipation * 100) : null;

  if (isAram) {
    const dmgShare = o.teamDamageShare != null ? Math.round(o.teamDamageShare * 100) : null;
    const csmin = o.totalCs != null && durMin ? Math.round((o.totalCs / durMin) * 10) / 10 : null;
    return [
      compareStat("kda", "KDA", kda, ARAM_REF.kda, "", "higher"),
      compareStat("kp", "Kill participation", kp, ARAM_REF.kp, "%", "higher"),
      compareStat("dmgshare", "Damage share", dmgShare, ARAM_REF.dmgShare, "%", "higher"),
      compareStat("csmin", "CS / min", csmin, ARAM_REF.csmin, "", "higher"),
    ].filter((c) => c.value != null);
  }

  const vision = o.visionScore != null && durMin ? Math.round((o.visionScore / durMin) * 100) / 100 : null;
  const objs =
    o.dragons == null && o.heralds == null && o.barons == null
      ? null
      : (o.dragons ?? 0) + (o.heralds ?? 0) + (o.barons ?? 0);
  return [
    compareStat("cs10", "CS @ 10", o.csAt10 ?? null, bench.cs10, "", "higher"),
    compareStat("deaths15", "Deaths before 15", o.deathsBefore15 ?? null, bench.deaths15, "", "lower"),
    compareStat("gold15", "Gold @ 15", o.goldDiffAt15 ?? null, bench.gold15, "gold", "higher"),
    compareStat("kp", "Kill participation", kp, bench.kp, "%", "higher"),
    compareStat("vision", "Vision / min", vision, bench.vision, "", "higher"),
    compareStat("kda", "KDA", kda, bench.kda, "", "higher"),
    compareStat("solo", "Solo kills", o.soloKills ?? null, bench.solo, "", "higher"),
    compareStat("obj", "Team objectives", objs, bench.obj, "", "higher"),
  ].filter((c) => c.value != null);
}
