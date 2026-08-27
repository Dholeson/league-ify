import type {
  EnrichedMatch,
  ChampionMilestone,
  ChampionTrack,
  Role,
} from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// CHAMPION PROGRESSION
//
// The leveling system lives on champions now, not the account. Each champion
// carries a set of Eternals-style tiered milestones. Clearing a tier raises
// that champion's mastery level; the level maps to a rank title. You level up
// the champions you actually play — the progression is earned in-role.
// ---------------------------------------------------------------------------

const def = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;

type Agg = (ms: EnrichedMatch[]) => number;

interface MilestoneDef {
  id: string;
  label: string;
  unit: string;
  tiers: [number, number, number];
  roles?: Role[]; // when set, only counts for these roles
  agg: Agg;
  fmt?: (v: number) => string;
  detail: (v: number, tierIndex: number) => string;
}

const sum = (ms: EnrichedMatch[], pick: (m: EnrichedMatch) => number | null | undefined) =>
  ms.reduce((a, m) => a + (pick(m) ?? 0), 0);
const count = (ms: EnrichedMatch[], pred: (m: EnrichedMatch) => boolean) =>
  ms.filter(pred).length;
const best = (ms: EnrichedMatch[], pick: (m: EnrichedMatch) => number | null | undefined) =>
  ms.reduce((a, m) => Math.max(a, pick(m) ?? 0), 0);

const kCompact = (v: number) =>
  v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v)}`;

// The milestone catalogue. Universal ones apply to every champion; role-tagged
// ones only surface for the roles where they mean something.
const MILESTONES: MilestoneDef[] = [
  {
    id: "games",
    label: "Games mastered",
    unit: "games",
    tiers: [10, 25, 60],
    agg: (ms) => ms.length,
    detail: (v) => `${v} games played`,
  },
  {
    id: "wins",
    label: "Victories",
    unit: "wins",
    tiers: [5, 15, 35],
    agg: (ms) => count(ms, (m) => !!m.objective.win),
    detail: (v) => `${v} wins`,
  },
  {
    id: "takedowns",
    label: "Takedown collector",
    unit: "takedowns",
    tiers: [100, 400, 1000],
    agg: (ms) => sum(ms, (m) => (m.objective.kills ?? 0) + (m.objective.assists ?? 0)),
    detail: (v) => `${v} kills + assists`,
  },
  {
    id: "flawless",
    label: "Flawless openings",
    unit: "games",
    tiers: [3, 10, 25],
    agg: (ms) =>
      count(ms, (m) => m.objective.deathsBefore15 != null && m.objective.deathsBefore15 <= 1),
    detail: (v) => `${v} games with ≤1 death before 15`,
  },
  {
    id: "damage",
    label: "Damage dealt",
    unit: "dmg",
    tiers: [50000, 200000, 600000],
    agg: (ms) => sum(ms, (m) => m.objective.damageToChampions),
    fmt: kCompact,
    detail: (v) => `${kCompact(v)} damage to champions`,
  },
  {
    id: "playmaker",
    label: "High-impact games",
    unit: "games",
    tiers: [3, 12, 30],
    agg: (ms) =>
      count(ms, (m) => (m.objective.killParticipation ?? 0) >= 0.6),
    detail: (v) => `${v} games at 60%+ kill participation`,
  },
  {
    id: "objectives",
    label: "Objectives secured",
    unit: "objectives",
    tiers: [15, 60, 150],
    agg: (ms) =>
      sum(
        ms,
        (m) =>
          (m.objective.dragons ?? 0) + (m.objective.heralds ?? 0) + (m.objective.barons ?? 0)
      ),
    detail: (v) => `${v} drakes / heralds / barons on your teams`,
  },
  // --- role-specific ---
  {
    id: "solo_kills",
    label: "Solo kills",
    unit: "kills",
    tiers: [5, 25, 75],
    roles: ["TOP", "MID", "BOT", "UNKNOWN"],
    agg: (ms) => sum(ms, (m) => m.objective.soloKills),
    detail: (v) => `${v} 1v1 kills`,
  },
  {
    id: "cs_best",
    label: "Best CS @ 10",
    unit: "cs",
    tiers: [70, 85, 100],
    roles: ["TOP", "MID", "BOT", "JUNGLE", "UNKNOWN"],
    agg: (ms) => best(ms, (m) => m.objective.csAt10),
    detail: (v) => `best game: ${v} CS at 10`,
  },
  {
    id: "vision",
    label: "Vision score",
    unit: "vision",
    tiers: [200, 800, 2500],
    roles: ["SUPPORT", "JUNGLE"],
    agg: (ms) => sum(ms, (m) => m.objective.visionScore),
    fmt: kCompact,
    detail: (v) => `${kCompact(v)} lifetime vision score`,
  },
];

const RANKS: { min: number; title: string }[] = [
  { min: 0.85, title: "Virtuoso" },
  { min: 0.6, title: "Expert" },
  { min: 0.4, title: "Adept" },
  { min: 0.2, title: "Apprentice" },
  { min: 0.0001, title: "Initiate" },
  { min: 0, title: "Unproven" },
];

export function rankTitle(level: number, maxLevel: number): string {
  const r = maxLevel ? level / maxLevel : 0;
  return RANKS.find((x) => r >= x.min)!.title;
}

// Most-played role across a champion's games (ignoring UNKNOWN when possible).
export function inferRole(ms: EnrichedMatch[], hint?: Role | null): Role {
  const counts = new Map<Role, number>();
  for (const m of ms) {
    const r = m.objective.role;
    if (!r || r === "UNKNOWN") continue;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ?? (hint && hint !== "UNKNOWN" ? hint : "UNKNOWN");
}

function buildMilestone(d: MilestoneDef, ms: EnrichedMatch[]): ChampionMilestone {
  const value = Math.round(d.agg(ms));
  let tierIndex = 0;
  for (const t of d.tiers) if (value >= t) tierIndex++;
  const maxed = tierIndex >= d.tiers.length;
  const prev = tierIndex === 0 ? 0 : d.tiers[tierIndex - 1];
  const nextTarget = maxed ? null : d.tiers[tierIndex];
  const pct = maxed
    ? 100
    : Math.max(0, Math.min(100, Math.round(((value - prev) / (nextTarget! - prev)) * 100)));
  return {
    id: d.id,
    label: d.label,
    unit: d.unit,
    tiers: d.tiers,
    value,
    tierIndex,
    nextTarget,
    pct,
    detail: d.detail(value, tierIndex),
    tone: tierIndex >= 2 ? "good" : "neutral",
  };
}

export function buildChampionTrack(
  champion: string,
  ms: EnrichedMatch[],
  roleHint?: Role | null
): ChampionTrack {
  const role = inferRole(ms, roleHint);
  const defs = MILESTONES.filter((d) => !d.roles || d.roles.includes(role));
  const milestones = defs.map((d) => buildMilestone(d, ms));
  const level = milestones.reduce((a, m) => a + m.tierIndex, 0);
  const maxLevel = milestones.length * 3;
  const nextUp =
    milestones
      .filter((m) => m.nextTarget != null)
      .sort((a, b) => b.pct - a.pct)[0] ?? null;
  return {
    champion,
    role,
    games: ms.length,
    level,
    maxLevel,
    rank: rankTitle(level, maxLevel),
    pct: maxLevel ? Math.round((level / maxLevel) * 100) : 0,
    milestones,
    nextUp,
  };
}
